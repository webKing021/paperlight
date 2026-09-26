//! Watched roots, exclusion patterns and key/value settings.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::now_ms;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
}

pub fn list_roots(conn: &Connection) -> AppResult<Vec<Root>> {
    let mut stmt = conn.prepare("SELECT id, path, enabled FROM roots ORDER BY path")?;
    let rows = stmt.query_map([], |r| {
        Ok(Root {
            id: r.get(0)?,
            path: r.get(1)?,
            enabled: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Normalises a folder path for storage: backslashes, and drives keep their trailing `\`.
pub fn normalize_root(path: &str) -> String {
    let p = path.trim().replace('/', "\\");
    let trimmed = p.trim_end_matches('\\');
    if trimmed.len() == 2 && trimmed.ends_with(':') {
        format!("{trimmed}\\")
    } else {
        trimmed.to_string()
    }
}

/// True when `child` is `parent` itself or lies somewhere below it (case-insensitive).
pub fn is_within(child: &str, parent: &str) -> bool {
    let c = child.to_lowercase();
    let c = c.trim_end_matches('\\');
    let p = parent.to_lowercase();
    let p = p.trim_end_matches('\\');
    c == p || c.starts_with(&format!("{p}\\"))
}

/// Adds a root. Nested roots are avoided: adding a folder already covered by a root is an
/// error, and adding a parent of existing roots replaces them.
pub fn add_root(conn: &mut Connection, path: &str) -> AppResult<Root> {
    let path = normalize_root(path);
    if path.is_empty() {
        return Err(AppError::msg("Folder path is empty"));
    }
    let existing = list_roots(conn)?;
    if let Some(parent) = existing.iter().find(|r| is_within(&path, &r.path)) {
        return Err(AppError::msg(format!(
            "{path} is already covered by {}",
            parent.path
        )));
    }
    let tx = conn.transaction()?;
    for child in existing.iter().filter(|r| is_within(&r.path, &path)) {
        // Files keep their rows; they are re-attached to the new root on the next scan.
        tx.execute(
            "UPDATE files SET root_id = NULL WHERE root_id = ?1",
            [child.id],
        )?;
        tx.execute("DELETE FROM roots WHERE id = ?1", [child.id])?;
    }
    tx.execute(
        "INSERT INTO roots (path, enabled, added_at) VALUES (?1, 1, ?2)",
        params![path, now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(Root {
        id,
        path,
        enabled: true,
    })
}

pub fn remove_root(conn: &Connection, id: i64) -> AppResult<()> {
    // ON DELETE CASCADE drops the root's files (and their FTS rows via trigger).
    conn.execute("DELETE FROM roots WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_root_enabled(conn: &Connection, id: i64, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE roots SET enabled = ?2 WHERE id = ?1",
        params![id, enabled],
    )?;
    Ok(())
}

pub fn list_exclusions(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT pattern FROM exclusions ORDER BY pattern")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn add_exclusion(conn: &Connection, pattern: &str) -> AppResult<()> {
    let pattern = pattern.trim();
    if !pattern.is_empty() {
        conn.execute(
            "INSERT OR IGNORE INTO exclusions (pattern) VALUES (?1)",
            [pattern],
        )?;
    }
    Ok(())
}

pub fn remove_exclusion(conn: &Connection, pattern: &str) -> AppResult<()> {
    conn.execute("DELETE FROM exclusions WHERE pattern = ?1", [pattern])?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_drive_and_folder_paths() {
        assert_eq!(normalize_root("D:"), "D:\\");
        assert_eq!(normalize_root("D:\\"), "D:\\");
        assert_eq!(normalize_root("D:/Work/Clients/"), "D:\\Work\\Clients");
    }

    #[test]
    fn detects_nested_paths() {
        assert!(is_within("D:\\Work\\Acme", "D:\\"));
        assert!(is_within("d:\\work\\acme", "D:\\Work"));
        assert!(is_within("D:\\Work", "D:\\Work"));
        assert!(!is_within("D:\\Workshop", "D:\\Work"));
        assert!(!is_within("C:\\Work", "D:\\"));
    }
}
