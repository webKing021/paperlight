//! Duplicate documents: identical copies of the same file in different places.
//!
//! Cheap first, expensive last, and only when asked (the Duplicates view):
//! 1. Only documents that share their exact size with another one are candidates (an index
//!    lookup, no disk access).
//! 2. Within a size, the first 64 KB are compared, which rules out most look-alikes after a
//!    tiny read.
//! 3. Only files that still collide are hashed in full with blake3, at background priority.
//!    The hash is stored and reused until the file's size or date changes.
//!
//! Files are only ever read, never changed, moved or deleted.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::files::{FileRow, FILE_COLUMNS};
use crate::db::Db;
use crate::error::AppResult;
use crate::indexer::priority;

/// Bytes compared before committing to a full hash.
const HEAD: u64 = 64 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(150);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    /// Size of each copy in bytes.
    pub size: i64,
    pub files: Vec<FileRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupProgress {
    pub done: usize,
    pub total: usize,
}

struct Candidate {
    id: i64,
    path: String,
    size: i64,
    modified_at: Option<i64>,
    hash: Option<Vec<u8>>,
}

/// Leaves background mode when hashing ends, however it ends (the thread is pooled).
struct BackgroundGuard;

impl Drop for BackgroundGuard {
    fn drop(&mut self) {
        priority::leave_background();
    }
}

/// Hashes whatever is needed, then returns every group of identical documents.
pub fn find(db: &Db, mut on_progress: impl FnMut(&DupProgress)) -> AppResult<Vec<DupGroup>> {
    priority::enter_background();
    let _guard = BackgroundGuard;

    let candidates = candidates(&db.reader())?;
    let mut by_size: Vec<Vec<Candidate>> = Vec::new();
    for c in candidates {
        match by_size.last_mut() {
            Some(group) if group[0].size == c.size => group.push(c),
            _ => by_size.push(vec![c]),
        }
    }
    // Only sizes with a file that has no hash yet need any disk access.
    by_size.retain(|g| g.iter().any(|c| c.hash.is_none()));

    let mut progress = DupProgress {
        done: 0,
        total: by_size.iter().map(Vec::len).sum(),
    };
    let mut last_emit = Instant::now();
    on_progress(&progress);

    for group in by_size {
        let hashed = hash_group(&group, |n| {
            progress.done += n;
            if last_emit.elapsed() >= PROGRESS_EVERY {
                last_emit = Instant::now();
                on_progress(&progress);
            }
        });
        store(db, &hashed)?;
    }
    progress.done = progress.total;
    on_progress(&progress);

    list_groups(&db.reader())
}

/// Documents whose size is shared with at least one other document.
fn candidates(conn: &Connection) -> AppResult<Vec<Candidate>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, size, modified_at, hash FROM files
         WHERE size IN (SELECT size FROM files WHERE size > 0
                        GROUP BY size HAVING COUNT(*) > 1)
         ORDER BY size",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Candidate {
            id: r.get(0)?,
            path: r.get(1)?,
            size: r.get(2)?,
            modified_at: r.get(3)?,
            hash: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Full hashes for the files of one size that need one and may have a twin. Files that can't
/// be read (moved, locked) are skipped. `step` is told how many files were looked at.
fn hash_group(group: &[Candidate], mut step: impl FnMut(usize)) -> Vec<(&Candidate, [u8; 32])> {
    let size = group[0].size as u64;
    // Small files: the head is the whole file.
    let twins: Vec<&Candidate> = if size <= HEAD {
        group.iter().collect()
    } else {
        let mut by_head: HashMap<[u8; 32], Vec<&Candidate>> = HashMap::new();
        for c in group {
            if let Ok(head) = hash_file(&c.path, Some(HEAD)) {
                by_head.entry(head).or_default().push(c);
            }
            step(1);
        }
        by_head
            .into_values()
            .filter(|v| v.len() > 1)
            .flatten()
            .collect()
    };

    let mut out = Vec::new();
    for c in twins {
        if c.hash.is_none() {
            if let Ok(full) = hash_file(&c.path, None) {
                out.push((c, full));
            }
        }
        if size <= HEAD {
            step(1);
        }
    }
    out
}

fn hash_file(path: &str, limit: Option<u64>) -> std::io::Result<[u8; 32]> {
    let file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    match limit {
        Some(n) => hasher.update_reader(file.take(n))?,
        None => hasher.update_reader(file)?,
    };
    Ok(*hasher.finalize().as_bytes())
}

/// Saves hashes, but only for files that didn't change while they were being read.
fn store(db: &Db, hashed: &[(&Candidate, [u8; 32])]) -> AppResult<()> {
    if hashed.is_empty() {
        return Ok(());
    }
    let mut conn = db.writer();
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "UPDATE files SET hash = ?2 WHERE id = ?1 AND size = ?3 AND modified_at IS ?4",
        )?;
        for (c, hash) in hashed {
            stmt.execute(params![c.id, &hash[..], c.size, c.modified_at])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Groups of identical documents from the stored hashes (no disk access), biggest first.
pub fn list_groups(conn: &Connection) -> AppResult<Vec<DupGroup>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FILE_COLUMNS}, f.hash FROM files f
         WHERE f.hash IS NOT NULL
           AND EXISTS (SELECT 1 FROM files g
                       WHERE g.hash = f.hash AND g.size = f.size AND g.id <> f.id)
         ORDER BY f.size DESC, f.hash, f.modified_at DESC"
    ))?;
    let rows = stmt.query_map([], |r| {
        Ok((FileRow::from_row(r)?, r.get::<_, Vec<u8>>(12)?))
    })?;
    let mut groups: Vec<DupGroup> = Vec::new();
    let mut last_hash: Option<Vec<u8>> = None;
    for row in rows {
        let (file, hash) = row?;
        let same =
            last_hash.as_ref() == Some(&hash) && groups.last().is_some_and(|g| g.size == file.size);
        if same {
            if let Some(g) = groups.last_mut() {
                g.files.push(file);
            }
        } else {
            groups.push(DupGroup {
                size: file.size,
                files: vec![file],
            });
            last_hash = Some(hash);
        }
    }
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::roots;
    use crate::indexer::scanner::{scan, ScanMode};
    use std::fs;
    use std::sync::atomic::AtomicBool;

    fn setup() -> (tempfile::TempDir, Db, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let docs = tmp.path().join("docs");
        fs::create_dir_all(docs.join("copy")).unwrap();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut big_other = big.clone();
        *big_other.last_mut().unwrap() ^= 0xff; // same size and head, different tail

        fs::write(docs.join("Report.pdf"), b"same bytes").unwrap();
        fs::write(docs.join("copy").join("Report (1).pdf"), b"same bytes").unwrap();
        fs::write(docs.join("Other.pdf"), b"diff bytes").unwrap(); // same size only
        fs::write(docs.join("Unique.docx"), b"no twin at all").unwrap();
        fs::write(docs.join("Deck.pptx"), &big).unwrap();
        fs::write(docs.join("copy").join("Deck.pptx"), &big).unwrap();
        fs::write(docs.join("Deck v2.pptx"), &big_other).unwrap();

        let db = Db::open(&tmp.path().join("test.db")).unwrap();
        roots::add_root(&mut db.writer(), &docs.to_string_lossy()).unwrap();
        scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        (tmp, db, docs)
    }

    fn names(groups: &[DupGroup]) -> Vec<Vec<String>> {
        groups
            .iter()
            .map(|g| {
                let mut v: Vec<String> = g.files.iter().map(|f| f.name.clone()).collect();
                v.sort();
                v
            })
            .collect()
    }

    #[test]
    fn finds_identical_copies_only() {
        let (_tmp, db, _docs) = setup();
        let groups = find(&db, |_| {}).unwrap();
        assert_eq!(
            names(&groups),
            [
                vec!["Deck.pptx".to_string(), "Deck.pptx".to_string()],
                vec!["Report (1).pdf".to_string(), "Report.pdf".to_string()],
            ]
        );
        assert_eq!(groups[0].size, 200_000);
    }

    #[test]
    fn hashes_are_reused_and_cleared_when_a_file_changes() {
        let (_tmp, db, docs) = setup();
        let first = names(&find(&db, |_| {}).unwrap());
        let stored: i64 = db
            .reader()
            .query_row(
                "SELECT COUNT(*) FROM files WHERE hash IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Small files are hashed whole; "Deck v2" shares the first 64 KB, so it is hashed too.
        assert_eq!(stored, 6);
        assert_eq!(names(&list_groups(&db.reader()).unwrap()), first);

        fs::write(docs.join("copy").join("Report (1).pdf"), b"edited, longer").unwrap();
        scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        let hash: Option<Vec<u8>> = db
            .reader()
            .query_row(
                "SELECT hash FROM files WHERE name = 'Report (1).pdf'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(hash.is_none());
        assert_eq!(names(&find(&db, |_| {}).unwrap()).len(), 1);
    }

    #[test]
    fn different_head_is_never_hashed_in_full() {
        let (_tmp, db, docs) = setup();
        let mut odd: Vec<u8> = vec![7; 200_000];
        odd[0] = 1;
        fs::write(docs.join("Odd.pptx"), &odd).unwrap();
        scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        find(&db, |_| {}).unwrap();
        let hash: Option<Vec<u8>> = db
            .reader()
            .query_row("SELECT hash FROM files WHERE name = 'Odd.pptx'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(hash.is_none());
    }
}
