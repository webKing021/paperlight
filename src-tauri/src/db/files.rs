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
                          created_at = ?8, modified_at = ?9, last_seen_at = ?10
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
    Ok(stats)
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    #[default]
    Modified,
    Name,
    Size,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub kind: Option<String>,
    /// Only files modified at or after this unix-ms timestamp.
    pub modified_after: Option<i64>,
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
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub total: i64,
    pub offset: i64,
    pub items: Vec<FileRow>,
}

pub fn list_files(conn: &Connection, q: &ListQuery) -> AppResult<Page> {
    let mut conditions = Vec::new();
    let mut args: Vec<Value> = Vec::new();
    if let Some(kind) = &q.kind {
        conditions.push("kind = ?");
        args.push(Value::Text(kind.clone()));
    }
    if let Some(after) = q.modified_after {
        conditions.push("modified_at >= ?");
        args.push(Value::Integer(after));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM files {where_clause}"),
        params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let dir = if q.ascending { "ASC" } else { "DESC" };
    let order = match q.sort {
        SortKey::Modified => format!("modified_at {dir}, name COLLATE NOCASE"),
        SortKey::Name => format!("name COLLATE NOCASE {dir}"),
        SortKey::Size => format!("size {dir}, name COLLATE NOCASE"),
    };
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let offset = q.offset.max(0);
    let sql = format!(
        "SELECT {FILE_COLUMNS} FROM files f {where_clause}
         ORDER BY {order} LIMIT {limit} OFFSET {offset}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(args.iter()), FileRow::from_row)?
        .collect::<Result<_, _>>()?;

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
