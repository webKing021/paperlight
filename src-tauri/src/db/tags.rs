//! User labels. They live only in Paperlight's database: files on disk are never modified.

use rusqlite::{params, Connection};
use serde::Serialize;

use super::now_ms;
use crate::error::{AppError, AppResult};

/// Label-ink colour keys; the UI maps each to a theme-aware colour.
pub const TAG_COLORS: &[&str] = &[
    "brick", "slate", "moss", "ochre", "plum", "teal", "graphite",
];
const MAX_NAME: usize = 40;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

pub fn list_tags(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, COUNT(ft.file_id)
         FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn clean_name(name: &str) -> AppResult<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(AppError::msg("Tag name can't be empty"));
    }
    Ok(name.chars().take(MAX_NAME).collect())
}

fn clean_color(color: &str) -> AppResult<&'static str> {
    TAG_COLORS
        .iter()
        .copied()
        .find(|c| *c == color)
        .ok_or_else(|| AppError::msg("Unknown tag colour"))
}

/// Creates a tag, cycling through the palette. An existing tag with the same name is returned
/// instead of failing.
pub fn create_tag(conn: &Connection, name: &str) -> AppResult<Tag> {
    let name = clean_name(name)?;
    if let Some(existing) = list_tags(conn)?
        .into_iter()
        .find(|t| t.name.eq_ignore_ascii_case(&name))
    {
        return Ok(existing);
    }
    let used: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
    let color = TAG_COLORS[used as usize % TAG_COLORS.len()];
    conn.execute(
        "INSERT INTO tags (name, color, created_at) VALUES (?1, ?2, ?3)",
        params![name, color, now_ms()],
    )?;
    Ok(Tag {
        id: conn.last_insert_rowid(),
        name,
        color: color.to_string(),
        count: 0,
    })
}

pub fn update_tag(conn: &Connection, id: i64, name: &str, color: &str) -> AppResult<()> {
    let name = clean_name(name)?;
    let color = clean_color(color)?;
    conn.execute(
        "UPDATE tags SET name = ?2, color = ?3 WHERE id = ?1",
        params![id, name, color],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::msg(format!("A tag called \"{name}\" already exists"))
        }
        other => other.into(),
    })?;
    Ok(())
}

pub fn delete_tag(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_file_tag(conn: &Connection, file_id: i64, tag_id: i64, on: bool) -> AppResult<()> {
    if on {
        conn.execute(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
            [file_id, tag_id],
        )?;
    } else {
        conn.execute(
            "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
            [file_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn set_favourite(conn: &Connection, file_id: i64, on: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET is_favourite = ?2 WHERE id = ?1",
        params![file_id, on],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::files::{insert_batch, FileRecord};
    use crate::db::{roots, Db};

    fn db_with_file() -> (tempfile::TempDir, Db, i64) {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("t.db")).unwrap();
        let mut conn = db.writer();
        let root = roots::add_root(&mut conn, "D:\\").unwrap();
        let tx = conn.transaction().unwrap();
        insert_batch(
            &tx,
            root.id,
            0,
            &[FileRecord {
                path: r"D:\a.pdf".into(),
                name: "a.pdf".into(),
                ext: "pdf".into(),
                kind: "pdf",
                dir: "D:".into(),
                size: 1,
                created_at: None,
                modified_at: None,
            }],
        )
        .unwrap();
        tx.commit().unwrap();
        let id = conn.last_insert_rowid();
        drop(conn);
        (tmp, db, id)
    }

    #[test]
    fn tags_are_created_counted_and_removed_with_the_file() {
        let (_t, db, file) = db_with_file();
        let conn = db.writer();
        let tax = create_tag(&conn, "  Tax   2025 ").unwrap();
        assert_eq!(tax.name, "Tax 2025");
        assert_eq!(create_tag(&conn, "tax 2025").unwrap().id, tax.id);
        set_file_tag(&conn, file, tax.id, true).unwrap();
        set_file_tag(&conn, file, tax.id, true).unwrap();
        assert_eq!(list_tags(&conn).unwrap()[0].count, 1);
        crate::db::files::delete_ids(&conn, &[file]).unwrap();
        assert_eq!(list_tags(&conn).unwrap()[0].count, 0);
    }

    #[test]
    fn colours_cycle_and_duplicates_are_rejected_on_rename() {
        let (_t, db, _file) = db_with_file();
        let conn = db.writer();
        let a = create_tag(&conn, "A").unwrap();
        let b = create_tag(&conn, "B").unwrap();
        assert_ne!(a.color, b.color);
        assert!(update_tag(&conn, b.id, "a", "plum").is_err());
        assert!(update_tag(&conn, b.id, "Bee", "neon").is_err());
        update_tag(&conn, b.id, "Bee", "plum").unwrap();
    }
}
