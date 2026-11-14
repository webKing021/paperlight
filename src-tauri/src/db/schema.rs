//! Schema migrations, applied in order and tracked with `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::AppResult;

const MIGRATIONS: &[&str] = &[
    // v1 — roots, exclusions, files + trigram name/path index, settings
    r#"
    CREATE TABLE roots (
        id        INTEGER PRIMARY KEY,
        path      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        enabled   INTEGER NOT NULL DEFAULT 1,
        added_at  INTEGER NOT NULL
    );

    CREATE TABLE exclusions (
        id       INTEGER PRIMARY KEY,
        pattern  TEXT NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE files (
        id              INTEGER PRIMARY KEY,
        path            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name            TEXT    NOT NULL,
        ext             TEXT    NOT NULL,
        kind            TEXT    NOT NULL,
        dir             TEXT    NOT NULL,
        root_id         INTEGER REFERENCES roots(id) ON DELETE CASCADE,
        size            INTEGER NOT NULL,
        created_at      INTEGER,
        modified_at     INTEGER,
        first_seen_at   INTEGER NOT NULL,
        last_seen_at    INTEGER NOT NULL,
        content_status  INTEGER NOT NULL DEFAULT 0,
        is_favourite    INTEGER NOT NULL DEFAULT 0,
        open_count      INTEGER NOT NULL DEFAULT 0,
        last_opened_at  INTEGER
    );

    CREATE INDEX files_kind     ON files(kind);
    CREATE INDEX files_modified ON files(modified_at DESC);
    CREATE INDEX files_root     ON files(root_id);
    CREATE INDEX files_dir      ON files(dir COLLATE NOCASE);

    -- Trigram FTS gives fast substring matching on names and folders ("voic" -> "Invoice").
    CREATE VIRTUAL TABLE files_fts USING fts5(
        name, dir,
        content = 'files', content_rowid = 'id',
        tokenize = 'trigram'
    );

    CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, name, dir) VALUES (new.id, new.name, new.dir);
    END;
    CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, name, dir) VALUES ('delete', old.id, old.name, old.dir);
    END;
    -- Only name/dir changes touch the FTS index, so metadata refreshes during rescans stay cheap.
    CREATE TRIGGER files_au AFTER UPDATE OF name, dir ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, name, dir) VALUES ('delete', old.id, old.name, old.dir);
        INSERT INTO files_fts(rowid, name, dir) VALUES (new.id, new.name, new.dir);
    END;

    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    );
    "#,
    // v2 — tags (labels kept in Paperlight only; files on disk are never touched)
    r#"
    CREATE TABLE tags (
        id          INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        color       TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
    );

    CREATE TABLE file_tags (
        file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (file_id, tag_id)
    ) WITHOUT ROWID;
    CREATE INDEX file_tags_tag ON file_tags(tag_id);

    CREATE INDEX files_opened ON files(last_opened_at DESC) WHERE last_opened_at IS NOT NULL;
    CREATE INDEX files_favourite ON files(is_favourite) WHERE is_favourite = 1;
    "#,
    // v3: text inside documents, read in the background (reshaped by v5)
    r#"
    CREATE VIRTUAL TABLE content_fts USING fts5(
        body,
        tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER files_content_ad AFTER DELETE ON files BEGIN
        DELETE FROM content_fts WHERE rowid = old.id;
    END;
    CREATE INDEX files_content_pending ON files(content_status) WHERE content_status = 0;
    "#,
    // v4: duplicates (blake3 of files that share a size, cleared when a file changes) and
    // storage insights (largest files)
    r#"
    ALTER TABLE files ADD COLUMN hash BLOB;
    CREATE INDEX files_size ON files(size);
    CREATE INDEX files_hash ON files(hash) WHERE hash IS NOT NULL;
    "#,
    // v5: whole documents are searchable (up to 200 K characters, was 32 K), so the text is
    // kept compressed in `doc_text` and indexed as external content (see db/text.rs).
    // Documents that had hit the old limit are queued to be read again.
    r#"
    UPDATE files SET content_status = 0
     WHERE id IN (SELECT rowid FROM content_fts WHERE length(body) >= 31000);

    CREATE TABLE doc_text (
        id  INTEGER PRIMARY KEY,
        z   BLOB NOT NULL
    );
    INSERT INTO doc_text (id, z)
        SELECT c.rowid, pl_zip(c.body) FROM content_fts c
         WHERE c.rowid IN (SELECT id FROM files) AND length(c.body) > 0;

    DROP TRIGGER files_content_ad;
    DROP TABLE content_fts;

    CREATE VIEW doc_text_plain AS SELECT id, pl_unzip(z) AS body FROM doc_text;
    CREATE VIRTUAL TABLE content_fts USING fts5(
        body,
        content = 'doc_text_plain', content_rowid = 'id',
        tokenize = 'unicode61 remove_diacritics 2'
    );
    INSERT INTO content_fts (content_fts) VALUES ('rebuild');

    CREATE TRIGGER files_content_ad AFTER DELETE ON files BEGIN
        INSERT INTO content_fts (content_fts, rowid, body)
            SELECT 'delete', id, pl_unzip(z) FROM doc_text WHERE id = old.id;
        DELETE FROM doc_text WHERE id = old.id;
    END;
    "#,
];

/// Brings the schema up to date. Returns `true` if anything was migrated.
pub fn migrate(conn: &mut Connection) -> AppResult<bool> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let pending = MIGRATIONS.len() as i64 > current;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(pending)
}
