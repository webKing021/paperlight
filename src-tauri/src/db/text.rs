//! The text read from inside documents, stored compressed.
//!
//! `doc_text` keeps one zlib blob per document; `content_fts` is an FTS5 index over it with
//! *external content* (the view `doc_text_plain` inflates a blob only when a passage is
//! needed). That keeps the database about a third the size of storing the text plainly, which
//! is what lets Paperlight index whole documents instead of their first pages.
//!
//! An external-content index must be told the exact old text when a row goes away, so every
//! change goes through [`set`] (or the `files_content_ad` trigger when a document is deleted).

use std::io::{Read, Write};

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection, Error};

use crate::error::AppResult;

/// Registers `pl_zip(text) -> blob` and `pl_unzip(blob) -> text`. The schema's view and trigger
/// use them, so every connection needs them before it touches the database.
pub fn register(conn: &Connection) -> rusqlite::Result<()> {
    // Innocuous + deterministic: SQLite allows them inside views and triggers.
    let flags = FunctionFlags::SQLITE_UTF8
        | FunctionFlags::SQLITE_DETERMINISTIC
        | FunctionFlags::SQLITE_INNOCUOUS;
    conn.create_scalar_function("pl_zip", 1, flags, |ctx| {
        let text = ctx.get_raw(0).as_str().map_err(user_err)?;
        zip(text).map_err(user_err)
    })?;
    conn.create_scalar_function("pl_unzip", 1, flags, |ctx| {
        let blob = ctx.get_raw(0).as_blob().map_err(user_err)?;
        unzip(blob).map_err(user_err)
    })?;
    Ok(())
}

fn user_err(e: impl std::error::Error + Send + Sync + 'static) -> Error {
    Error::UserFunctionError(Box::new(e))
}

fn zip(text: &str) -> std::io::Result<Vec<u8>> {
    let mut enc = ZlibEncoder::new(Vec::with_capacity(text.len() / 3), Compression::new(6));
    enc.write_all(text.as_bytes())?;
    enc.finish()
}

fn unzip(blob: &[u8]) -> std::io::Result<String> {
    let mut out = String::with_capacity(blob.len() * 3);
    ZlibDecoder::new(blob).read_to_string(&mut out)?;
    Ok(out)
}

/// Replaces a document's text (`None` or empty: it has none). Call inside a transaction.
pub fn set(conn: &Connection, id: i64, text: Option<&str>) -> AppResult<()> {
    conn.prepare_cached(
        "INSERT INTO content_fts (content_fts, rowid, body)
         SELECT 'delete', id, pl_unzip(z) FROM doc_text WHERE id = ?1",
    )?
    .execute([id])?;
    conn.prepare_cached("DELETE FROM doc_text WHERE id = ?1")?
        .execute([id])?;
    if let Some(text) = text.filter(|t| !t.is_empty()) {
        conn.prepare_cached("INSERT INTO doc_text (id, z) VALUES (?1, pl_zip(?2))")?
            .execute(params![id, text])?;
        conn.prepare_cached("INSERT INTO content_fts (rowid, body) VALUES (?1, ?2)")?
            .execute(params![id, text])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::files::{delete_ids, insert_batch, FileRecord};
    use crate::db::{roots, Db};

    fn db_with_files(n: usize) -> (tempfile::TempDir, Db) {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("t.db")).unwrap();
        {
            let mut conn = db.writer();
            let root = roots::add_root(&mut conn, "D:\\").unwrap();
            let records: Vec<FileRecord> = (0..n)
                .map(|i| FileRecord {
                    path: format!("D:\\{i}.pdf"),
                    name: format!("{i}.pdf"),
                    ext: "pdf".into(),
                    kind: "pdf",
                    dir: "D:".into(),
                    size: 1,
                    created_at: None,
                    modified_at: None,
                })
                .collect();
            let tx = conn.transaction().unwrap();
            insert_batch(&tx, root.id, 0, &records).unwrap();
            tx.commit().unwrap();
        }
        (tmp, db)
    }

    fn hits(db: &Db, word: &str) -> Vec<i64> {
        let conn = db.reader();
        let mut stmt = conn
            .prepare("SELECT rowid FROM content_fts WHERE content_fts MATCH ?1 ORDER BY rowid")
            .unwrap();
        let rows = stmt.query_map([word], |r| r.get(0)).unwrap();
        rows.collect::<Result<_, _>>().unwrap()
    }

    #[test]
    fn round_trips_and_shrinks() {
        let text = "Quarterly forecast for the Café account. ".repeat(500);
        let z = zip(&text).unwrap();
        assert!(z.len() < text.len() / 10);
        assert_eq!(unzip(&z).unwrap(), text);
    }

    #[test]
    fn replacing_and_removing_text_keeps_the_index_exact() {
        let (_t, db) = db_with_files(2);
        let conn = db.writer();
        set(&conn, 1, Some("alpha budget")).unwrap();
        set(&conn, 2, Some("beta budget")).unwrap();
        assert_eq!(hits(&db, "budget"), [1, 2]);

        set(&conn, 1, Some("gamma only")).unwrap();
        assert_eq!(hits(&db, "budget"), [2]);
        assert!(hits(&db, "alpha").is_empty());
        assert_eq!(hits(&db, "gamma"), [1]);

        set(&conn, 1, None).unwrap();
        assert!(hits(&db, "gamma").is_empty());

        // Deleting the document clears its text and index entries through the trigger.
        delete_ids(&conn, &[2]).unwrap();
        assert!(hits(&db, "budget").is_empty());
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM doc_text", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        let ok: String = conn
            .query_row(
                "INSERT INTO content_fts (content_fts, rank) VALUES ('integrity-check', 1)
                 RETURNING 'ok'",
                [],
                |r| r.get(0),
            )
            .unwrap_or_else(|e| e.to_string());
        assert_eq!(ok, "ok");
    }
}
