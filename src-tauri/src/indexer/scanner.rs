//! Full scan: walks every enabled root in parallel and syncs the `files` table with disk.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jwalk::{Parallelism, WalkDir};
use serde::Serialize;

use super::filters::{is_ignored_file, kind_for_ext, Exclusions};
use crate::db::files::{self, FileRecord};
use crate::db::roots::{self, Root};
use crate::db::{now_ms, Db};
use crate::error::AppResult;

const BATCH_SIZE: usize = 2_000;
const PROGRESS_EVERY: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub root: String,
    pub dirs_scanned: u64,
    pub files_found: u64,
    pub current_dir: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub files_found: u64,
    pub dirs_scanned: u64,
    pub removed: u64,
    pub errors: u64,
    pub duration_ms: u64,
    pub cancelled: bool,
}

/// Scans all enabled roots. Files not found again are removed, but only for roots that were
/// walked to completion, so a cancelled scan or an unplugged drive never loses data.
pub fn scan(
    db: &Db,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(&ScanProgress),
) -> AppResult<ScanSummary> {
    let started = Instant::now();
    let (root_list, patterns, scan_gen) = {
        let conn = db.writer();
        let gen = roots::get_setting(&conn, "scan_gen")?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0)
            + 1;
        roots::set_setting(&conn, "scan_gen", &gen.to_string())?;
        (
            roots::list_roots(&conn)?,
            roots::list_exclusions(&conn)?,
            gen,
        )
    };
    let exclusions = Arc::new(Exclusions::new(&patterns));
    let mut summary = ScanSummary::default();

    for root in root_list.iter().filter(|r| r.enabled) {
        if cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        if !Path::new(&root.path).is_dir() {
            continue; // drive offline or folder gone: keep its rows until it comes back
        }
        let complete = scan_root(
            db,
            root,
            scan_gen,
            &exclusions,
            cancel,
            &mut summary,
            &mut on_progress,
        )?;
        if complete {
            summary.removed += files::remove_stale(&db.writer(), root.id, scan_gen)? as u64;
        } else {
            summary.cancelled = true;
            break;
        }
    }

    if !summary.cancelled {
        let conn = db.writer();
        summary.removed += files::remove_orphans(&conn)? as u64;
        roots::set_setting(&conn, "last_scan_at", &now_ms().to_string())?;
    }
    summary.duration_ms = started.elapsed().as_millis() as u64;
    Ok(summary)
}

/// Walks one root. Returns `false` if the scan was cancelled part-way.
fn scan_root(
    db: &Db,
    root: &Root,
    scan_gen: i64,
    exclusions: &Arc<Exclusions>,
    cancel: &AtomicBool,
    summary: &mut ScanSummary,
    on_progress: &mut impl FnMut(&ScanProgress),
) -> AppResult<bool> {
    let ex = Arc::clone(exclusions);
    let walker = WalkDir::new(&root.path)
        .skip_hidden(false)
        .follow_links(false)
        .parallelism(Parallelism::RayonNewPool(0))
        .process_read_dir(move |_depth, _dir, _state, children| {
            // Prune excluded folders before jwalk descends into them.
            children.retain(|entry| match entry {
                Ok(e) if e.file_type().is_dir() => {
                    let path = e.path();
                    !ex.is_excluded_dir(&path.to_string_lossy(), &e.file_name().to_string_lossy())
                }
                _ => true,
            });
        });

    let mut batch: Vec<FileRecord> = Vec::with_capacity(BATCH_SIZE);
    let mut last_emit = Instant::now();
    let mut progress = ScanProgress {
        root: root.path.clone(),
        dirs_scanned: summary.dirs_scanned,
        files_found: summary.files_found,
        current_dir: root.path.clone(),
    };
    on_progress(&progress);

    for entry in walker {
        if cancel.load(Ordering::Relaxed) {
            flush(db, root.id, scan_gen, &mut batch)?;
            return Ok(false);
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                summary.errors += 1; // usually "access denied"
                continue;
            }
        };
        let file_type = entry.file_type();
        if file_type.is_dir() {
            summary.dirs_scanned += 1;
            if last_emit.elapsed() >= PROGRESS_EVERY {
                progress.dirs_scanned = summary.dirs_scanned;
                progress.files_found = summary.files_found;
                progress.current_dir = entry.path().to_string_lossy().into_owned();
                on_progress(&progress);
                last_emit = Instant::now();
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(record) = to_record(&entry.path(), name, || entry.metadata().ok()) {
            batch.push(record);
            summary.files_found += 1;
            if batch.len() >= BATCH_SIZE {
                flush(db, root.id, scan_gen, &mut batch)?;
            }
        }
    }
    flush(db, root.id, scan_gen, &mut batch)?;

    progress.dirs_scanned = summary.dirs_scanned;
    progress.files_found = summary.files_found;
    on_progress(&progress);
    Ok(true)
}

/// Builds an index record if `name` is a document; metadata is only read for documents.
pub fn to_record(
    path: &Path,
    name: String,
    metadata: impl FnOnce() -> Option<std::fs::Metadata>,
) -> Option<FileRecord> {
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    let kind = kind_for_ext(&ext)?;
    if is_ignored_file(&name) {
        return None;
    }
    let md = metadata()?;
    Some(FileRecord {
        path: path.to_string_lossy().into_owned(),
        dir: path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        name,
        ext,
        kind,
        size: md.len() as i64,
        created_at: md.created().ok().and_then(to_ms),
        modified_at: md.modified().ok().and_then(to_ms),
    })
}

fn to_ms(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn flush(db: &Db, root_id: i64, scan_gen: i64, batch: &mut Vec<FileRecord>) -> AppResult<()> {
    if batch.is_empty() {
        return Ok(());
    }
    let mut conn = db.writer();
    let tx = conn.transaction()?;
    files::upsert_batch(&tx, root_id, scan_gen, now_ms(), batch)?;
    tx.commit()?;
    batch.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::files::{list_files, ListQuery};
    use std::fs;

    fn setup() -> (tempfile::TempDir, Db, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let docs = tmp.path().join("docs");
        fs::create_dir_all(docs.join("Clients").join("Acme")).unwrap();
        fs::create_dir_all(docs.join("node_modules").join("pkg")).unwrap();
        fs::write(docs.join("Invoice March.pdf"), b"%PDF").unwrap();
        fs::write(
            docs.join("Clients").join("Acme").join("Proposal.docx"),
            b"x",
        )
        .unwrap();
        fs::write(docs.join("Budget.XLSX"), b"x").unwrap();
        fs::write(docs.join("~$Budget.xlsx"), b"x").unwrap();
        fs::write(docs.join("notes.exe"), b"x").unwrap();
        fs::write(
            docs.join("node_modules").join("pkg").join("readme.pdf"),
            b"x",
        )
        .unwrap();

        let db = Db::open(&tmp.path().join("test.db")).unwrap();
        {
            let mut conn = db.writer();
            roots::add_root(&mut conn, &docs.to_string_lossy()).unwrap();
            roots::add_exclusion(&conn, "node_modules").unwrap();
        }
        (tmp, db, docs)
    }

    fn names(db: &Db) -> Vec<String> {
        let mut v: Vec<String> = list_files(
            &db.reader(),
            &ListQuery {
                limit: Some(100),
                ..Default::default()
            },
        )
        .unwrap()
        .items
        .into_iter()
        .map(|f| f.name)
        .collect();
        v.sort();
        v
    }

    #[test]
    fn indexes_documents_and_skips_the_rest() {
        let (_tmp, db, _docs) = setup();
        let summary = scan(&db, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(summary.files_found, 3);
        assert_eq!(
            names(&db),
            ["Budget.XLSX", "Invoice March.pdf", "Proposal.docx"]
        );
        let stats = files::stats(&db.reader()).unwrap();
        assert_eq!(stats.by_kind.get("excel"), Some(&1));
    }

    #[test]
    fn rescan_removes_deleted_and_adds_new_files() {
        let (_tmp, db, docs) = setup();
        scan(&db, &AtomicBool::new(false), |_| {}).unwrap();

        fs::remove_file(docs.join("Invoice March.pdf")).unwrap();
        fs::write(docs.join("Slides.pptx"), b"x").unwrap();
        let summary = scan(&db, &AtomicBool::new(false), |_| {}).unwrap();

        assert_eq!(summary.removed, 1);
        assert_eq!(names(&db), ["Budget.XLSX", "Proposal.docx", "Slides.pptx"]);
    }

    #[test]
    fn cancelled_scan_keeps_existing_rows() {
        let (_tmp, db, _docs) = setup();
        scan(&db, &AtomicBool::new(false), |_| {}).unwrap();
        let summary = scan(&db, &AtomicBool::new(true), |_| {}).unwrap();
        assert!(summary.cancelled);
        assert_eq!(names(&db).len(), 3);
    }

    #[test]
    fn trigram_index_finds_substrings() {
        let (_tmp, db, _docs) = setup();
        scan(&db, &AtomicBool::new(false), |_| {}).unwrap();
        let conn = db.reader();
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM files_fts WHERE files_fts MATCH '\"voic\"'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }

    /// Real-machine benchmark: `cargo test --release scan_this_machine -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn scan_this_machine() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("bench.db")).unwrap();
        crate::indexer::seed_defaults(&db).unwrap();
        let summary = scan(&db, &AtomicBool::new(false), |_| {}).unwrap();
        let rescan = scan(&db, &AtomicBool::new(false), |_| {}).unwrap();
        let stats = files::stats(&db.reader()).unwrap();
        println!("first scan: {summary:?}");
        println!("rescan:     {rescan:?}");
        println!("stats:      {stats:?}");
    }
}
