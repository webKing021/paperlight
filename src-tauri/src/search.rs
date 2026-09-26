//! Ranked, typo-tolerant search over document names and folders.
//!
//! 1. **Exact stage**: every query term must appear in the name or folder. Terms of 3+ chars
//!    use the FTS5 trigram index; shorter terms fall back to `LIKE` (cheap at this scale).
//! 2. **Fuzzy stage** (only when the exact stage finds little): names sharing enough trigrams
//!    with the query, so "invocie" still finds "Invoice".
//!
//! Candidates are then scored in Rust: where the match is (name ≫ folder), how well it matches
//! (whole name, prefix, word start), plus small boosts for recent, favourite and often-opened
//! files.

use std::collections::{HashMap, HashSet};

use rusqlite::{params_from_iter, types::Value, Connection};
use serde::Deserialize;

use crate::db::files::{attach_tags, FileRow, Page, ViewFilter, FILE_COLUMNS};
use crate::db::now_ms;
use crate::error::AppResult;

const MAX_CANDIDATES: i64 = 2_000;
const MAX_TERMS: usize = 8;
/// Below this many exact hits we also look for near-misses.
const FUZZY_WHEN_FEWER_THAN: usize = 5;
/// Share of the query's trigrams a name must contain to count as a fuzzy match.
const FUZZY_MIN_SIMILARITY: f64 = 0.75;
/// Every exact match outranks every typo-tolerant guess.
const EXACT_BASE: f64 = 50.0;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub text: String,
    #[serde(flatten)]
    pub filter: ViewFilter,
    #[serde(default)]
    pub offset: i64,
    pub limit: Option<i64>,
}

struct Scored {
    row: FileRow,
    score: f64,
}

pub fn search(conn: &Connection, q: &SearchQuery) -> AppResult<Page> {
    let terms: Vec<String> = q
        .text
        .split_whitespace()
        .map(str::to_lowercase)
        .take(MAX_TERMS)
        .collect();
    let offset = q.offset.max(0);
    if terms.is_empty() {
        return Ok(Page {
            total: 0,
            offset,
            items: Vec::new(),
        });
    }

    let (filter_sql, filter_args) = q.filter.to_sql();
    let now = now_ms();
    let mut results: HashMap<i64, Scored> = HashMap::new();

    for row in exact_candidates(conn, &terms, &filter_sql, &filter_args)? {
        if let Some(score) = exact_score(&row, &terms) {
            let score = EXACT_BASE + score + boost(&row, now);
            results.insert(row.id, Scored { row, score });
        }
    }

    let joined: String = terms.join(" ");
    if results.len() < FUZZY_WHEN_FEWER_THAN && joined.chars().count() >= 4 {
        let query_grams = trigrams(&joined.replace(' ', ""));
        for row in fuzzy_candidates(conn, &query_grams, &filter_sql, &filter_args)? {
            if results.contains_key(&row.id) {
                continue;
            }
            let name = row.name.to_lowercase();
            let fuzzy = match edit_match(&terms, &name) {
                Some(score) => score,
                None => {
                    let sim = similarity(&query_grams, &name);
                    if sim < FUZZY_MIN_SIMILARITY {
                        continue;
                    }
                    12.0 * sim
                }
            };
            let score = fuzzy + boost(&row, now);
            results.insert(row.id, Scored { row, score });
        }
    }

    let mut ranked: Vec<Scored> = results.into_values().collect();
    ranked.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| b.row.modified_at.cmp(&a.row.modified_at))
    });
    let total = ranked.len() as i64;
    let limit = q.limit.unwrap_or(200).clamp(1, 1000) as usize;
    let mut items: Vec<FileRow> = ranked
        .into_iter()
        .skip(offset as usize)
        .take(limit)
        .map(|s| s.row)
        .collect();
    attach_tags(conn, &mut items)?;
    Ok(Page {
        total,
        offset,
        items,
    })
}

fn exact_candidates(
    conn: &Connection,
    terms: &[String],
    filter_sql: &str,
    filter_args: &[Value],
) -> AppResult<Vec<FileRow>> {
    let mut args: Vec<Value> = Vec::new();
    let sql = if terms.iter().all(|t| t.chars().count() >= 3) {
        let expr = terms
            .iter()
            .map(|t| fts_phrase(t))
            .collect::<Vec<_>>()
            .join(" AND ");
        args.push(Value::Text(expr));
        format!(
            "SELECT {FILE_COLUMNS} FROM files_fts JOIN files f ON f.id = files_fts.rowid
             WHERE files_fts MATCH ?{filter_sql}
             ORDER BY bm25(files_fts, 10.0, 1.0) LIMIT {MAX_CANDIDATES}"
        )
    } else {
        let mut conds = Vec::new();
        for t in terms {
            conds.push("(f.name LIKE ? ESCAPE '\\' OR f.dir LIKE ? ESCAPE '\\')");
            let pattern = format!("%{}%", like_escape(t));
            args.push(Value::Text(pattern.clone()));
            args.push(Value::Text(pattern));
        }
        format!(
            "SELECT {FILE_COLUMNS} FROM files f WHERE {}{filter_sql}
             ORDER BY f.modified_at DESC LIMIT {MAX_CANDIDATES}",
            conds.join(" AND ")
        )
    };
    args.extend_from_slice(filter_args);
    query_rows(conn, &sql, &args)
}

fn fuzzy_candidates(
    conn: &Connection,
    query_grams: &HashSet<String>,
    filter_sql: &str,
    filter_args: &[Value],
) -> AppResult<Vec<FileRow>> {
    if query_grams.is_empty() {
        return Ok(Vec::new());
    }
    let expr = format!(
        "name : ({})",
        query_grams
            .iter()
            .map(|g| fts_phrase(g))
            .collect::<Vec<_>>()
            .join(" OR ")
    );
    let mut args = vec![Value::Text(expr)];
    args.extend_from_slice(filter_args);
    let sql = format!(
        "SELECT {FILE_COLUMNS} FROM files_fts JOIN files f ON f.id = files_fts.rowid
         WHERE files_fts MATCH ?{filter_sql}
         ORDER BY bm25(files_fts) LIMIT {MAX_CANDIDATES}"
    );
    query_rows(conn, &sql, &args)
}

fn query_rows(conn: &Connection, sql: &str, args: &[Value]) -> AppResult<Vec<FileRow>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), FileRow::from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Relevance of an exact match, or `None` if some term is missing entirely.
fn exact_score(row: &FileRow, terms: &[String]) -> Option<f64> {
    let name = row.name.to_lowercase();
    let stem = name.rsplit_once('.').map_or(name.as_str(), |(s, _)| s);
    let dir = row.dir.to_lowercase();
    let phrase = terms.join(" ");

    let mut score = 0.0;
    let mut all_in_name = true;
    for t in terms {
        if let Some(pos) = name.find(t.as_str()) {
            score += 8.0;
            if pos == 0 || !name.as_bytes()[pos - 1].is_ascii_alphanumeric() {
                score += 5.0; // starts a word: "inv" in "March Invoice"
            }
        } else if dir.contains(t.as_str()) {
            all_in_name = false;
            score += 3.0;
        } else {
            return None;
        }
    }
    if stem == phrase {
        score += 100.0;
    } else if stem.starts_with(&phrase) {
        score += 60.0;
    } else if name.contains(&phrase) {
        score += 40.0;
    } else if all_in_name {
        score += 25.0;
    }
    // Among equals, prefer shorter names (closer to what was typed).
    score -= (name.len() as f64 / 20.0).min(5.0);
    Some(score)
}

/// Small nudges so the file you are most likely after wins ties.
fn boost(row: &FileRow, now: i64) -> f64 {
    const DAY: i64 = 86_400_000;
    let mut b = 0.0;
    if let Some(m) = row.modified_at {
        let days = (now - m) / DAY;
        b += match days {
            ..=7 => 8.0,
            8..=30 => 5.0,
            31..=365 => 2.0,
            _ => 0.0,
        };
    }
    if row.is_favourite {
        b += 15.0;
    }
    b += (row.open_count.min(10) as f64) * 1.5;
    if row.last_opened_at.is_some_and(|t| now - t < 7 * DAY) {
        b += 5.0;
    }
    b
}

fn trigrams(s: &str) -> HashSet<String> {
    let chars: Vec<char> = s.chars().collect();
    chars.windows(3).map(|w| w.iter().collect()).collect()
}

/// Fraction of the query's trigrams that also occur in `name`.
fn similarity(query_grams: &HashSet<String>, name: &str) -> f64 {
    if query_grams.is_empty() {
        return 0.0;
    }
    let name_grams = trigrams(name);
    let shared = query_grams.intersection(&name_grams).count();
    shared as f64 / query_grams.len() as f64
}

/// Typos allowed in a word of this length.
fn allowed_typos(len: usize) -> usize {
    match len {
        0..=4 => 0,
        5..=8 => 1,
        _ => 2,
    }
}

/// Every term must be within a small edit distance of some word in the name (or contained in
/// it). Returns a score that shrinks with the number of typos.
fn edit_match(terms: &[String], name: &str) -> Option<f64> {
    let words: Vec<Vec<char>> = name
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.chars().collect())
        .collect();
    let mut typos = 0;
    for t in terms {
        if name.contains(t.as_str()) {
            continue;
        }
        let term: Vec<char> = t.chars().collect();
        let allowed = allowed_typos(term.len());
        let best = words
            .iter()
            .filter_map(|w| osa_distance(&term, w, allowed))
            .min()?;
        typos += best;
    }
    Some(15.0 - 4.0 * typos as f64)
}

/// Optimal-string-alignment distance (edits + adjacent swaps), or `None` if above `max`.
fn osa_distance(a: &[char], b: &[char], max: usize) -> Option<usize> {
    if a.len().abs_diff(b.len()) > max {
        return None;
    }
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(d[i - 2][j - 2] + 1);
            }
            d[i][j] = v;
        }
    }
    (d[n][m] <= max).then_some(d[n][m])
}

/// Quotes a term as an FTS5 phrase so user input can never be parsed as query syntax.
fn fts_phrase(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

fn like_escape(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::files::{insert_batch, FileRecord};
    use crate::db::{roots, Db};

    fn db_with(names: &[(&str, &str)]) -> (tempfile::TempDir, Db) {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("s.db")).unwrap();
        {
            let mut conn = db.writer();
            let root = roots::add_root(&mut conn, "D:\\").unwrap();
            let records: Vec<FileRecord> = names
                .iter()
                .map(|(dir, name)| FileRecord {
                    path: format!("{dir}\\{name}"),
                    name: name.to_string(),
                    ext: name.rsplit_once('.').unwrap().1.to_lowercase(),
                    kind: "pdf",
                    dir: dir.to_string(),
                    size: 10,
                    created_at: None,
                    modified_at: Some(0),
                })
                .collect();
            let tx = conn.transaction().unwrap();
            insert_batch(&tx, root.id, 0, &records).unwrap();
            tx.commit().unwrap();
        }
        (tmp, db)
    }

    fn find(db: &Db, text: &str) -> Vec<String> {
        search(
            &db.reader(),
            &SearchQuery {
                text: text.into(),
                ..Default::default()
            },
        )
        .unwrap()
        .items
        .into_iter()
        .map(|r| r.name)
        .collect()
    }

    fn sample() -> (tempfile::TempDir, Db) {
        db_with(&[
            ("D:\\Work\\Acme", "Invoice March 2024.pdf"),
            ("D:\\Work\\Acme", "Proposal v3.docx"),
            ("D:\\Personal", "Resume.pdf"),
            ("D:\\Personal\\Tax", "ITR acknowledgement.pdf"),
            ("D:\\Work", "invoice.pdf"),
            ("D:\\Study", "DBMS CV notes.pdf"),
        ])
    }

    #[test]
    fn exact_name_ranks_first() {
        let (_t, db) = sample();
        assert_eq!(
            find(&db, "invoice"),
            ["invoice.pdf", "Invoice March 2024.pdf"]
        );
    }

    #[test]
    fn substring_and_multi_term() {
        let (_t, db) = sample();
        assert_eq!(find(&db, "voic mar"), ["Invoice March 2024.pdf"]);
    }

    #[test]
    fn folder_names_match_too() {
        let (_t, db) = sample();
        let hits = find(&db, "acme");
        assert_eq!(hits.len(), 2);
        assert_eq!(find(&db, "tax"), ["ITR acknowledgement.pdf"]);
    }

    #[test]
    fn short_terms_use_like() {
        let (_t, db) = sample();
        assert_eq!(find(&db, "cv"), ["DBMS CV notes.pdf"]);
        assert_eq!(find(&db, "v3"), ["Proposal v3.docx"]);
    }

    #[test]
    fn typos_are_tolerated() {
        let (_t, db) = sample();
        assert!(find(&db, "invocie").contains(&"invoice.pdf".to_string()));
        assert_eq!(find(&db, "resumee"), ["Resume.pdf"]);
    }

    #[test]
    fn edit_distance_counts_swaps_as_one() {
        let a: Vec<char> = "invocie".chars().collect();
        let b: Vec<char> = "invoice".chars().collect();
        assert_eq!(osa_distance(&a, &b, 2), Some(1));
        assert_eq!(
            osa_distance(&a, &"budget".chars().collect::<Vec<_>>(), 2),
            None
        );
    }

    #[test]
    fn typo_matching_is_not_too_loose() {
        let (_t, db) = db_with(&[
            (r"D:\Papers", "Voice assistants survey.pdf"),
            (r"D:\Papers", "Consumer trust.pdf"),
            (r"D:\Me", "Resume.pdf"),
        ]);
        assert!(find(&db, "invoice").is_empty());
        assert_eq!(find(&db, "resume"), ["Resume.pdf"]);
    }

    #[test]
    fn query_syntax_is_inert() {
        let (_t, db) = sample();
        assert!(find(&db, "\"OR* NEAR(").is_empty());
        assert!(find(&db, "100%").is_empty());
    }
}
