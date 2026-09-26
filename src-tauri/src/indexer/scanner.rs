//! Full sync: walks every enabled root and reconciles the `files` table with disk.
//!
//! The walk compares each document's size / modified time / name against an in-memory snapshot
//! of the index and writes only the differences, so rescanning an unchanged disk costs almost
//! no database I/O.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jwalk::{Parallelism, WalkDir};
use serde::Serialize;

use super::filters::{is_ignored_file, kind_for_ext, Exclusions};
use super::priority;
use crate::db::files::{self, FileRecord, Known};
use crate::db::roots::{self, Root};
use crate::db::{now_ms, Db};
use crate::error::AppResult;

const BATCH_SIZE: usize = 1_000;
const PROGRESS_EVERY: Duration = Duration::from_millis(150);

/// `Foreground` is a scan the user asked for (full speed); `Background` is automatic and runs
/// with low CPU / disk priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanMode {
    Foreground,
    Background,
}

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
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub errors: u64,
    pub duration_ms: u64,
    pub cancelled: bool,
}

#[cfg(test)]
impl ScanSummary {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

/// Leaves background mode when the scan ends, however it ends.
struct BackgroundGuard(bool);

impl Drop for BackgroundGuard {
    fn drop(&mut self) {
        if self.0 {
            priority::leave_background();
        }
    }
}

/// Syncs all enabled roots. Files not found again are removed, but only for roots that were
/// walked to completion, so a cancelled scan or an unplugged drive never loses data.
pub fn scan(
    db: &Db,
    cancel: &AtomicBool,
    mode: ScanMode,
    mut on_progress: impl FnMut(&ScanProgress),
) -> AppResult<ScanSummary> {
    let started = Instant::now();
    let background = mode == ScanMode::Background;
    if background {
        priority::enter_background();
    }
    let _guard = BackgroundGuard(background);

    let (root_list, patterns) = {
        let conn = db.reader();
        (roots::list_roots(&conn)?, roots::list_exclusions(&conn)?)
    };
    let exclusions = Arc::new(Exclusions::new(&patterns));
    let pool = priority::walker_pool(background)?;
    let mut summary = ScanSummary::default();

    for root in root_list.iter().filter(|r| r.enabled) {
        if cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        if !Path::new(&root.path).is_dir() {
            continue; // drive offline or folder gone: keep its rows until it comes back
        }
        let mut known = files::snapshot(&db.reader(), root.id)?;
        let walker = Walker {
            db,
            root,
            exclusions: &exclusions,
            pool: &pool,
            cancel,
        };
        if !walker.run(&mut known, &mut summary, &mut on_progress)? {
            summary.cancelled = true;
            break;
        }
        // Whatever is left in the snapshot was not found on disk any more.
        let gone: Vec<i64> = known.values().map(|k| k.id).collect();
        summary.removed += files::delete_ids(&mut db.writer(), &gone)? as u64;
    }

    if !summary.cancelled {
        let conn = db.writer();
        summary.removed += files::remove_orphans(&conn)? as u64;
        roots::set_setting(&conn, "last_scan_at", &now_ms().to_string())?;
        if summary.removed > 0 {
            // Give freed pages back to the OS so the index never grows without bound.
            conn.execute_batch("PRAGMA incremental_vacuum;")?;
        }
    }
    summary.duration_ms = started.elapsed().as_millis() as u64;
    Ok(summary)
}

struct Walker<'a> {
    db: &'a Db,
    root: &'a Root,
    exclusions: &'a Arc<Exclusions>,
    pool: &'a Arc<jwalk::rayon::ThreadPool>,
    cancel: &'a AtomicBool,
}

/// Documents waiting to be written, flushed in batches.
#[derive(Default)]
struct Pending {
    inserts: Vec<FileRecord>,
    updates: Vec<(i64, FileRecord)>,
}

impl Pending {
    fn len(&self) -> usize {
        self.inserts.len() + self.updates.len()
    }
}

impl Walker<'_> {
    /// Walks the root, removing every file it finds from `known`. Returns `false` if cancelled.
    fn run(
        &self,
        known: &mut HashMap<String, Known>,
        summary: &mut ScanSummary,
        on_progress: &mut impl FnMut(&ScanProgress),
    ) -> AppResult<bool> {
        let ex = Arc::clone(self.exclusions);
        let walk = WalkDir::new(&self.root.path)
            .skip_hidden(false)
            .follow_links(false)
            .parallelism(Parallelism::RayonExistingPool {
                pool: Arc::clone(self.pool),
                busy_timeout: None,
            })
            .process_read_dir(move |_depth, _dir, _state, children| {
                // Prune excluded folders before jwalk descends into them.
                children.retain(|entry| match entry {
                    Ok(e) if e.file_type().is_dir() => !ex.is_excluded_dir(
                        &e.path().to_string_lossy(),
                        &e.file_name().to_string_lossy(),
                    ),
                    _ => true,
                });
            });

        let mut pending = Pending::default();
        let mut last_emit = Instant::now();
        let mut progress = ScanProgress {
            root: self.root.path.clone(),
            dirs_scanned: summary.dirs_scanned,
            files_found: summary.files_found,
            current_dir: self.root.path.clone(),
        };
        on_progress(&progress);

        for entry in walk {
            if self.cancel.load(Ordering::Relaxed) {
                self.flush(&mut pending)?;
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
            let Some(record) = to_record(&entry.path(), name, || entry.metadata().ok()) else {
                continue;
            };
            summary.files_found += 1;
            match known.remove(&record.path.to_lowercase()) {
                Some(k) if k.matches(&record) => {}
                Some(k) => {
                    summary.updated += 1;
                    pending.updates.push((k.id, record));
                }
                None => {
                    summary.added += 1;
                    pending.inserts.push(record);
                }
            }
            if pending.len() >= BATCH_SIZE {
                self.flush(&mut pending)?;
            }
        }
        self.flush(&mut pending)?;

        progress.dirs_scanned = summary.dirs_scanned;
        progress.files_found = summary.files_found;
        on_progress(&progress);
        Ok(true)
    }

    fn flush(&self, pending: &mut Pending) -> AppResult<()> {
        if pending.len() == 0 {
            return Ok(());
        }
        let now = now_ms();
        let mut conn = self.db.writer();
        let tx = conn.transaction()?;
        files::insert_batch(&tx, self.root.id, now, &pending.inserts)?;
        files::update_batch(&tx, now, &pending.updates)?;
        tx.commit()?;
        pending.inserts.clear();
        pending.updates.clear();
        Ok(())
    }
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

    fn run(db: &Db) -> ScanSummary {
        scan(db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap()
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
        let summary = run(&db);
        assert_eq!(summary.files_found, 3);
        assert_eq!(summary.added, 3);
        assert_eq!(
            names(&db),
            ["Budget.XLSX", "Invoice March.pdf", "Proposal.docx"]
        );
        let stats = files::stats(&db.reader()).unwrap();
        assert_eq!(stats.by_kind.get("excel"), Some(&1));
    }

    #[test]
    fn unchanged_rescan_writes_nothing() {
        let (_tmp, db, _docs) = setup();
        run(&db);
        let summary = run(&db);
        assert_eq!(summary.files_found, 3);
        assert!(!summary.changed(), "{summary:?}");
    }

    #[test]
    fn rescan_applies_only_the_differences() {
        let (_tmp, db, docs) = setup();
        run(&db);

        fs::remove_file(docs.join("Invoice March.pdf")).unwrap();
        fs::write(docs.join("Slides.pptx"), b"x").unwrap();
        fs::write(docs.join("Budget.XLSX"), b"bigger now").unwrap();
        let summary = run(&db);

        assert_eq!((summary.added, summary.updated, summary.removed), (1, 1, 1));
        assert_eq!(names(&db), ["Budget.XLSX", "Proposal.docx", "Slides.pptx"]);
    }

    #[test]
    fn cancelled_scan_keeps_existing_rows() {
        let (_tmp, db, _docs) = setup();
        run(&db);
        let summary = scan(&db, &AtomicBool::new(true), ScanMode::Background, |_| {}).unwrap();
        assert!(summary.cancelled);
        assert_eq!(names(&db).len(), 3);
    }

    #[test]
    fn background_scan_gives_same_result() {
        let (_tmp, db, _docs) = setup();
        let summary = scan(&db, &AtomicBool::new(false), ScanMode::Background, |_| {}).unwrap();
        assert_eq!(summary.added, 3);
    }

    #[test]
    fn trigram_index_finds_substrings() {
        let (_tmp, db, _docs) = setup();
        run(&db);
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
        let first = run(&db);
        let rescan = scan(&db, &AtomicBool::new(false), ScanMode::Background, |_| {}).unwrap();
        let stats = files::stats(&db.reader()).unwrap();
        let db_size = std::fs::metadata(tmp.path().join("bench.db"))
            .map(|m| m.len())
            .unwrap_or(0);
        println!("first scan:        {first:?}");
        println!("background rescan: {rescan:?}");
        println!("stats:             {stats:?}");
        println!("db size:           {} KB", db_size / 1024);
        for text in ["resume", "invoice", "sem", "cv", "reprot", "dbms lab"] {
            let t = Instant::now();
            let page = crate::search::search(
                &db.reader(),
                &crate::search::SearchQuery {
                    text: text.into(),
                    ..Default::default()
                },
            )
            .unwrap();
            let top: Vec<&str> = page.items.iter().take(3).map(|r| r.name.as_str()).collect();
            println!(
                "search {text:>10}: {:>4} hits in {:>5.2} ms  top: {top:?}",
                page.total,
                t.elapsed().as_secs_f64() * 1000.0
            );
        }
    }
}
