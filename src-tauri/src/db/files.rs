//! The `files` table: change-only writes from scans, stats and paged listing.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Row, Transaction,
};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// A document found on disk, ready to be written to the index.
#[derive(Debug, Clone)]
pub struct FileRecord {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub kind: &'static str,
    pub dir: String,
    pub size: i64,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
}

/// What the index already knows about a file; used to detect changes without touching the DB.
#[derive(Debug, Clone)]
pub struct Known {
    pub id: i64,
    pub name: String,
    pub size: i64,
    pub modified_at: Option<i64>,
}

impl Known {
    pub fn matches(&self, f: &FileRecord) -> bool {
        self.size == f.size && self.modified_at == f.modified_at && self.name == f.name
    }
}

/// Snapshot of every indexed file under a root, keyed by lower-case path.
pub fn snapshot(conn: &Connection, root_id: i64) -> AppResult<HashMap<String, Known>> {
    let mut stmt =
        conn.prepare("SELECT id, path, name, size, modified_at FROM files WHERE root_id = ?1")?;
    let rows = stmt.query_map([root_id], |r| {
        Ok((
            r.get::<_, String>(1)?.to_lowercase(),
            Known {
                id: r.get(0)?,
                name: r.get(2)?,
                size: r.get(3)?,
                modified_at: r.get(4)?,
            },
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Inserts newly discovered files. A path already present under another (or no) root is
/// re-attached to this one instead.
pub fn insert_batch(
    tx: &Transaction,
    root_id: i64,
    now: i64,
    records: &[FileRecord],
) -> AppResult<()> {
    let mut stmt = tx.prepare_cached(
        "INSERT INTO files (path, name, ext, kind, dir, root_id, size, created_at, modified_at,
                            first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(path) DO UPDATE SET
             root_id      = excluded.root_id,
             content_status = CASE WHEN size = excluded.size
                                        AND modified_at IS excluded.modified_at
                                   THEN content_status ELSE 0 END,
             hash         = CASE WHEN size = excluded.size
                                        AND modified_at IS excluded.modified_at
                                   THEN hash ELSE NULL END,
             size         = excluded.size,
             created_at   = excluded.created_at,
             modified_at  = excluded.modified_at,
             last_seen_at = excluded.last_seen_at",
    )?;
    for f in records {
        stmt.execute(params![
            f.path,
            f.name,
            f.ext,
            f.kind,
            f.dir,
            root_id,
            f.size,
            f.created_at,
            f.modified_at,
            now
        ])?;
    }
    Ok(())
}

/// Rewrites known rows from fresh records (changed metadata, renames, moves). Keeping the row
/// id keeps everything attached to it: favourites, open history and, later, tags.
pub fn update_batch(tx: &Transaction, now: i64, records: &[(i64, FileRecord)]) -> AppResult<()> {
    let mut stmt = tx.prepare_cached(
        "UPDATE files SET path = ?2, name = ?3, ext = ?4, kind = ?5, dir = ?6, size = ?7,
                          created_at = ?8, modified_at = ?9, last_seen_at = ?10,
                          content_status = CASE WHEN size = ?7 AND modified_at IS ?9
                                                THEN content_status ELSE 0 END,
                          hash = CASE WHEN size = ?7 AND modified_at IS ?9
                                      THEN hash ELSE NULL END
         WHERE id = ?1",
    )?;
    for (id, f) in records {
        stmt.execute(params![
            id,
            f.path,
            f.name,
            f.ext,
            f.kind,
            f.dir,
            f.size,
            f.created_at,
            f.modified_at,
            now
        ])?;
    }
    Ok(())
}

/// Minimal view of an indexed file, used by the live watcher.
#[derive(Debug, Clone)]
pub struct Indexed {
    pub id: i64,
    pub name: String,
    pub size: i64,
    pub modified_at: Option<i64>,
}

fn indexed_from_row(r: &Row) -> rusqlite::Result<Indexed> {
    Ok(Indexed {
        id: r.get(0)?,
        name: r.get(1)?,
        size: r.get(2)?,
        modified_at: r.get(3)?,
    })
}

pub fn find_by_path(conn: &Connection, path: &str) -> AppResult<Option<Indexed>> {
    Ok(conn
        .query_row(
            "SELECT id, name, size, modified_at FROM files WHERE path = ?1",
            [path],
            indexed_from_row,
        )
        .optional()?)
}

/// Bounds selecting every path strictly inside `dir`: `dir\` <= path < `dir]` (`]` sorts right
/// after `\`). The column's NOCASE collation makes this an index range scan.
fn prefix_bounds(dir: &str) -> (String, String) {
    let dir = dir.trim_end_matches('\\');
    (format!("{dir}\\"), format!("{dir}]"))
}

pub fn files_under(conn: &Connection, dir: &str) -> AppResult<Vec<Indexed>> {
    let (lo, hi) = prefix_bounds(dir);
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, size, modified_at FROM files WHERE path >= ?1 AND path < ?2",
    )?;
    let rows = stmt.query_map([lo, hi], indexed_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// A folder was renamed or moved: rewrite the paths of everything inside it, keeping ids.
/// (`substr(dir, cut)` is empty for files directly inside `from`, so their dir becomes `to`.)
pub fn move_prefix(conn: &Connection, from: &str, to: &str) -> AppResult<usize> {
    let from = from.trim_end_matches('\\');
    let to = to.trim_end_matches('\\');
    let (lo, hi) = prefix_bounds(from);
    let cut = from.chars().count() as i64 + 1;
    Ok(conn.execute(
        "UPDATE files SET
             path = ?3 || substr(path, ?4),
             dir  = ?3 || substr(dir, ?4)
         WHERE path >= ?1 AND path < ?2",
        params![lo, hi, to, cut],
    )?)
}

/// Deletes rows by id (files that no longer exist on disk). Call inside a transaction when
/// deleting many.
pub fn delete_ids(conn: &Connection, ids: &[i64]) -> AppResult<usize> {
    let mut stmt = conn.prepare_cached("DELETE FROM files WHERE id = ?1")?;
    let mut removed = 0;
    for id in ids {
        removed += stmt.execute([id])?;
    }
    Ok(removed)
}

/// Drops rows that belong to no root any more (their root was removed or replaced and the
/// file was not found again by the following scan).
pub fn remove_orphans(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM files WHERE root_id IS NULL", [])?)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub total_size: i64,
    pub by_kind: BTreeMap<String, i64>,
    pub favourites: i64,
    pub opened: i64,
}

pub fn stats(conn: &Connection) -> AppResult<Stats> {
    let mut stats = Stats::default();
    let mut stmt =
        conn.prepare("SELECT kind, COUNT(*), COALESCE(SUM(size), 0) FROM files GROUP BY kind")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (kind, count, size) = row?;
        stats.total += count;
        stats.total_size += size;
        stats.by_kind.insert(kind, count);
    }
    (stats.favourites, stats.opened) = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM files WHERE is_favourite = 1),
                (SELECT COUNT(*) FROM files WHERE last_opened_at IS NOT NULL)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(stats)
}

/// Which slice of the index a view shows. Shared by browsing and searching, so every view
/// can also be searched.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ViewFilter {
    pub kind: Option<String>,
    /// Only files modified at or after this unix-ms timestamp.
    pub modified_after: Option<i64>,
    #[serde(default)]
    pub favourites: bool,
    /// Only files opened from Paperlight.
    #[serde(default)]
    pub opened: bool,
    pub tag_id: Option<i64>,
}

impl ViewFilter {
    /// Extra conditions on alias `f`, each starting with ` AND `, and their arguments.
    pub fn to_sql(&self) -> (String, Vec<Value>) {
        let mut sql = String::new();
        let mut args = Vec::new();
        if let Some(kind) = &self.kind {
            sql.push_str(" AND f.kind = ?");
            args.push(Value::Text(kind.clone()));
        }
        if let Some(after) = self.modified_after {
            sql.push_str(" AND f.modified_at >= ?");
            args.push(Value::Integer(after));
        }
        if self.favourites {
            sql.push_str(" AND f.is_favourite = 1");
        }
        if self.opened {
            sql.push_str(" AND f.last_opened_at IS NOT NULL");
        }
        if let Some(tag) = self.tag_id {
            sql.push_str(
                " AND EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id = ?)",
            );
            args.push(Value::Integer(tag));
        }
        (sql, args)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    #[default]
    Modified,
    Name,
    Size,
    /// Most recently opened from Paperlight.
    Opened,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    #[serde(flatten)]
    pub filter: ViewFilter,
    #[serde(default)]
    pub sort: SortKey,
    #[serde(default)]
    pub ascending: bool,
    #[serde(default)]
    pub offset: i64,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub kind: String,
    pub dir: String,
    pub size: i64,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub is_favourite: bool,
    pub open_count: i64,
    pub last_opened_at: Option<i64>,
    /// Ids of the tags on this file.
    pub tags: Vec<i64>,
    /// Matching passage from the document's text (search results only). Marked with
    /// U+0002 … U+0003 around matched words.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// Columns read by [`FileRow::from_row`], for queries that alias `files` as `f`.
pub const FILE_COLUMNS: &str = "f.id, f.path, f.name, f.ext, f.kind, f.dir, f.size, f.created_at,
     f.modified_at, f.is_favourite, f.open_count, f.last_opened_at";

impl FileRow {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            path: r.get(1)?,
            name: r.get(2)?,
            ext: r.get(3)?,
            kind: r.get(4)?,
            dir: r.get(5)?,
            size: r.get(6)?,
            created_at: r.get(7)?,
            modified_at: r.get(8)?,
            is_favourite: r.get(9)?,
            open_count: r.get(10)?,
            last_opened_at: r.get(11)?,
            tags: Vec::new(),
            snippet: None,
        })
    }
}

/// Fills in `tags` for a page of rows with a single query.
pub fn attach_tags(conn: &Connection, rows: &mut [FileRow]) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; rows.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT file_id, tag_id FROM file_tags WHERE file_id IN ({placeholders})"
    ))?;
    let pairs = stmt.query_map(params_from_iter(rows.iter().map(|r| r.id)), |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
    })?;
    let mut by_file: HashMap<i64, Vec<i64>> = HashMap::new();
    for pair in pairs {
        let (file, tag) = pair?;
        by_file.entry(file).or_default().push(tag);
    }
    for row in rows {
        if let Some(tags) = by_file.remove(&row.id) {
            row.tags = tags;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub total: i64,
    pub offset: i64,
    pub items: Vec<FileRow>,
}

pub fn list_files(conn: &Connection, q: &ListQuery) -> AppResult<Page> {
    let (filter_sql, args) = q.filter.to_sql();
    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM files f WHERE 1=1{filter_sql}"),
        params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let dir = if q.ascending { "ASC" } else { "DESC" };
    let order = match q.sort {
        SortKey::Modified => format!("f.modified_at {dir}, f.name COLLATE NOCASE"),
        SortKey::Name => format!("f.name COLLATE NOCASE {dir}"),
        SortKey::Size => format!("f.size {dir}, f.name COLLATE NOCASE"),
        SortKey::Opened => format!("f.last_opened_at {dir}, f.name COLLATE NOCASE"),
    };
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let offset = q.offset.max(0);
    let sql = format!(
        "SELECT {FILE_COLUMNS} FROM files f WHERE 1=1{filter_sql}
         ORDER BY {order} LIMIT {limit} OFFSET {offset}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut items: Vec<FileRow> = stmt
        .query_map(params_from_iter(args.iter()), FileRow::from_row)?
        .collect::<Result<_, _>>()?;
    attach_tags(conn, &mut items)?;

    Ok(Page {
        total,
        offset,
        items,
    })
}

pub fn path_of(conn: &Connection, id: i64) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT path FROM files WHERE id = ?1", [id], |r| r.get(0))
        .optional()?)
}

/// Remembers that a file was opened from Paperlight (feeds ranking and "Recently opened").
pub fn record_open(conn: &Connection, id: i64, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET open_count = open_count + 1, last_opened_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindUsage {
    pub kind: String,
    pub count: i64,
    pub size: i64,
}

/// Count and size per document kind, largest first.
pub fn usage_by_kind(conn: &Connection) -> AppResult<Vec<KindUsage>> {
    let mut stmt = conn.prepare(
        "SELECT kind, COUNT(*), COALESCE(SUM(size), 0) FROM files GROUP BY kind ORDER BY 3 DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(KindUsage {
            kind: r.get(0)?,
            count: r.get(1)?,
            size: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// The `limit` biggest documents (an index range scan on `files_size`).
pub fn largest(conn: &Connection, limit: i64) -> AppResult<Vec<FileRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FILE_COLUMNS} FROM files f ORDER BY f.size DESC LIMIT ?1"
    ))?;
    let mut rows: Vec<FileRow> = stmt
        .query_map([limit], FileRow::from_row)?
        .collect::<Result<_, _>>()?;
    attach_tags(conn, &mut rows)?;
    Ok(rows)
}

/// Number of indexed documents per extension.
pub fn count_by_ext(conn: &Connection) -> AppResult<HashMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT ext, COUNT(*) FROM files GROUP BY ext")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Number of indexed documents per root id.
pub fn count_by_root(conn: &Connection) -> AppResult<HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "SELECT root_id, COUNT(*) FROM files WHERE root_id IS NOT NULL GROUP BY root_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Empties the index (documents, their text, favourites, tags on documents, history). Tag
/// names, locations, exclusions and settings are kept. Files on disk are never touched.
pub fn reset_all(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    // Triggers clear the name and text indexes; file_tags cascade.
    tx.execute_batch(
        "DELETE FROM files;
         DELETE FROM settings WHERE key = 'last_scan_at';",
    )?;
    tx.commit()?;
    // Give the space back and keep the WAL small.
    conn.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

/// Everything the details panel shows about one document.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub file: FileRow,
    /// The start of the document's text, if it has been read.
    pub excerpt: Option<String>,
    /// 0 = waiting to be read, 1 = read, 2 = not readable format / too large, 3 = failed.
    pub text_status: i64,
}

pub fn details(conn: &Connection, id: i64) -> AppResult<Option<Details>> {
    let file = conn
        .query_row(
            &format!("SELECT {FILE_COLUMNS} FROM files f WHERE f.id = ?1"),
            [id],
            FileRow::from_row,
        )
        .optional()?;
    let Some(mut file) = file else {
        return Ok(None);
    };
    attach_tags(conn, std::slice::from_mut(&mut file))?;
    let excerpt = conn
        .query_row(
            "SELECT substr(body, 1, 1400) FROM content_fts WHERE rowid = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    let text_status = conn.query_row(
        "SELECT content_status FROM files WHERE id = ?1",
        [id],
        |r| r.get(0),
    )?;
    Ok(Some(Details {
        file,
        excerpt,
        text_status,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{roots, tags, Db};
    use crate::indexer::scanner::{scan, ScanMode};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn reset_empties_the_index_but_keeps_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let docs = tmp.path().join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(docs.join("a.pdf"), b"x").unwrap();
        std::fs::write(docs.join("b.docx"), b"y").unwrap();
        let db = Db::open(&tmp.path().join("test.db")).unwrap();
        roots::add_root(&mut db.writer(), &docs.to_string_lossy()).unwrap();
        roots::add_exclusion(&db.writer(), "build").unwrap();
        scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        let tag = tags::create_tag(&db.writer(), "tax").unwrap();
        tags::set_file_tag(&db.writer(), 1, tag.id, true).unwrap();

        reset_all(&mut db.writer()).unwrap();

        let conn = db.reader();
        assert_eq!(stats(&conn).unwrap().total, 0);
        let fts: i64 = conn
            .query_row("SELECT COUNT(*) FROM files_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts, 0);
        assert_eq!(roots::list_roots(&conn).unwrap().len(), 1);
        assert_eq!(roots::list_exclusions(&conn).unwrap(), ["build"]);
        assert_eq!(tags::list_tags(&conn).unwrap().len(), 1);
        assert!(roots::get_setting(&conn, "last_scan_at").unwrap().is_none());
        drop(conn);

        let again = scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
        assert_eq!(again.added, 2);
    }
}
