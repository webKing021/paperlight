//! The `files` table: batch upserts from scans, stale-row cleanup, stats and paged listing.

use std::collections::BTreeMap;

use rusqlite::{params, params_from_iter, types::Value, Connection, Transaction};
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

/// Inserts new files and refreshes metadata of known ones, stamping them with `scan_gen`.
/// Name/dir are left untouched on conflict so the FTS index is not rewritten needlessly.
pub fn upsert_batch(
    tx: &Transaction,
    root_id: i64,
    scan_gen: i64,
    now: i64,
    records: &[FileRecord],
) -> AppResult<()> {
    let mut stmt = tx.prepare_cached(
        "INSERT INTO files (path, name, ext, kind, dir, root_id, size, created_at, modified_at,
                            first_seen_at, last_seen_at, scan_gen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)
         ON CONFLICT(path) DO UPDATE SET
             root_id      = excluded.root_id,
             size         = excluded.size,
             created_at   = excluded.created_at,
             modified_at  = excluded.modified_at,
             last_seen_at = excluded.last_seen_at,
             scan_gen     = excluded.scan_gen",
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
            now,
            scan_gen
        ])?;
    }
    Ok(())
}

/// Removes files under `root_id` not seen in scan `scan_gen` (deleted while we weren't looking).
pub fn remove_stale(conn: &Connection, root_id: i64, scan_gen: i64) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM files WHERE root_id = ?1 AND scan_gen < ?2",
        params![root_id, scan_gen],
    )?)
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
        "SELECT id, path, name, ext, kind, dir, size, created_at, modified_at, is_favourite
         FROM files {where_clause} ORDER BY {order} LIMIT {limit} OFFSET {offset}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(FileRow {
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
            })
        })?
        .collect::<Result<_, _>>()?;

    Ok(Page {
        total,
        offset,
        items,
    })
}
