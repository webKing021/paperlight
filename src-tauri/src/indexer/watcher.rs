//! Live updates: turns file-system events into index changes while Paperlight runs.
//!
//! Efficiency rules:
//! * **Planned watches.** Drive roots and folders that contain excluded children (e.g. a user
//!   profile containing `AppData`) are watched *non-recursively*; everything else gets one
//!   recursive watch. So Windows, Program Files and AppData never produce a single event.
//! * **Early filtering.** Events for excluded paths or clearly irrelevant files (`.tmp`,
//!   `.log`, `.jpg`…) are dropped on notify's thread before they are queued.
//! * **Batching.** Events are applied in one transaction once the disk has been quiet for
//!   300 ms (at most every 2 s).
//! * **Identity-preserving.** Deletions inside a batch are deferred, so a rename, a move to
//!   another folder, or Office's "write temp file, swap names" save keeps the same row (and
//!   with it favourites, history and tags).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use jwalk::{Parallelism, WalkDir};
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Transaction;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::filters::{is_other_file, Exclusions};
use super::scanner::{to_record, ScanMode};
use super::{priority, spawn_scan};
use crate::db::files::{self, FileRecord, Indexed};
use crate::db::roots::{self, Root};
use crate::db::{now_ms, Db};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const QUIET: Duration = Duration::from_millis(300);
const MAX_BATCH: Duration = Duration::from_secs(2);
/// How deep the watch planner may split folders into separate watches.
const PLAN_MAX_DEPTH: usize = 4;
/// Drive roots are always split this many levels deep (`C:\` → `C:\Users` → `C:\Users\me`),
/// because excluded folders such as `AppData` sit a few levels down.
const DRIVE_SPLIT_DEPTH: usize = 2;

/// A running watcher. Dropping it stops watching and ends the event thread.
pub struct Watch {
    _watcher: Arc<Mutex<RecommendedWatcher>>,
    pub locations: usize,
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

pub fn is_running(app: &AppHandle) -> bool {
    lock(&app.state::<AppState>().watch).is_some()
}

pub fn watched_locations(app: &AppHandle) -> Option<usize> {
    lock(&app.state::<AppState>().watch)
        .as_ref()
        .map(|w| w.locations)
}

/// Re-plans watches after roots or exclusions changed (only if watching already).
pub fn refresh(app: &AppHandle) {
    if is_running(app) {
        if let Err(e) = restart(app) {
            eprintln!("paperlight: could not restart watcher: {e}");
        }
    }
}

/// (Re)starts watching every enabled root.
pub fn restart(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let mut slot = lock(&state.watch);
    *slot = None; // stop the previous watcher before planning a new one

    let (root_list, patterns) = {
        let conn = state.db.reader();
        (roots::list_roots(&conn)?, roots::list_exclusions(&conn)?)
    };
    let scope = Arc::new(Scope::new(root_list, Exclusions::new(&patterns)));

    let (tx, rx) = mpsc::channel();
    let filter = Arc::clone(&scope);
    let handler = move |res: notify::Result<Event>| {
        let keep = match &res {
            Ok(ev) => is_relevant(ev, &filter),
            Err(_) => true, // errors (e.g. buffer overflow) trigger a background re-sync
        };
        if keep {
            let _ = tx.send(res);
        }
    };
    let mut watcher =
        notify::recommended_watcher(handler).map_err(|e| AppError::msg(e.to_string()))?;

    let mut watched = HashMap::new();
    for root in &scope.roots {
        let path = Path::new(&root.path);
        if !path.is_dir() {
            continue;
        }
        for (dir, mode) in plan_watches(path, &scope.ex) {
            if watcher.watch(&dir, mode).is_ok() {
                watched.insert(dir, mode);
            }
        }
    }

    let locations = watched.len();
    let watcher = Arc::new(Mutex::new(watcher));
    let weak = Arc::downgrade(&watcher);
    let thread_app = app.clone();
    std::thread::Builder::new()
        .name("paperlight-watch".into())
        .spawn(move || run(thread_app, rx, weak, watched, scope))?;
    *slot = Some(Watch {
        _watcher: watcher,
        locations,
    });
    Ok(())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The event loop: batch, apply, notify the UI, adjust watches.
fn run(
    app: AppHandle,
    rx: Receiver<notify::Result<Event>>,
    watcher: Weak<Mutex<RecommendedWatcher>>,
    mut watched: HashMap<PathBuf, RecursiveMode>,
    scope: Arc<Scope>,
) {
    priority::enter_background();
    let state = app.state::<AppState>();

    // Ends when the watcher is dropped (its sender goes away).
    while let Ok(first) = rx.recv() {
        let mut batch = vec![first];
        let started = Instant::now();
        while started.elapsed() < MAX_BATCH {
            match rx.recv_timeout(QUIET) {
                Ok(ev) => batch.push(ev),
                Err(_) => break,
            }
        }

        let mut need_resync = false;
        let events: Vec<Event> = batch
            .into_iter()
            .filter_map(|res| match res {
                Ok(ev) => {
                    need_resync |= ev.need_rescan();
                    Some(ev)
                }
                Err(_) => {
                    need_resync = true;
                    None
                }
            })
            .collect();

        let applier = Applier {
            db: &state.db,
            scope: &scope,
        };
        match applier.apply(events) {
            Ok(applied) => {
                if applied.changed() {
                    let _ = app.emit("index-changed", &applied);
                }
                // A watched folder itself was renamed/moved: its watch would now report stale
                // paths, so plan everything again.
                let stale = applied.moved_dirs.iter().any(|moved| {
                    let moved = moved.to_string_lossy();
                    watched
                        .keys()
                        .any(|w| roots::is_within(&w.to_string_lossy(), &moved))
                });
                if stale {
                    if let Err(e) = restart(&app) {
                        eprintln!("paperlight: could not restart watcher: {e}");
                    }
                    return;
                }
                // New folders under a shallow (non-recursive) watch need their own watch.
                if let Some(w) = watcher.upgrade() {
                    for dir in applied.new_dirs {
                        let under_shallow = dir.parent().and_then(|p| watched.get(p))
                            == Some(&RecursiveMode::NonRecursive);
                        if under_shallow
                            && !watched.contains_key(&dir)
                            && lock(&w).watch(&dir, RecursiveMode::Recursive).is_ok()
                        {
                            watched.insert(dir, RecursiveMode::Recursive);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("paperlight: failed to apply file changes: {e}");
                need_resync = true;
            }
        }
        if need_resync {
            // Events were lost (buffer overflow) — reconcile quietly.
            spawn_scan(app.clone(), ScanMode::Background);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

/// Decides which folders to watch and how, so excluded trees are never watched at all.
pub fn plan_watches(root: &Path, ex: &Exclusions) -> Vec<(PathBuf, RecursiveMode)> {
    let mut out = Vec::new();
    let is_drive = root.parent().is_none();
    plan_dir(root, 0, is_drive, ex, &mut out);
    out
}

fn plan_dir(
    dir: &Path,
    depth: usize,
    is_drive: bool,
    ex: &Exclusions,
    out: &mut Vec<(PathBuf, RecursiveMode)>,
) {
    let children: Vec<(PathBuf, bool)> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| {
                    let e = e.ok()?;
                    let ft = e.file_type().ok()?;
                    if !ft.is_dir() || ft.is_symlink() {
                        return None;
                    }
                    let path = e.path();
                    let excluded = ex
                        .is_excluded_dir(&path.to_string_lossy(), &e.file_name().to_string_lossy());
                    Some((path, excluded))
                })
                .collect()
        })
        .unwrap_or_default();

    let has_excluded = children.iter().any(|(_, excluded)| *excluded);
    let split = depth < PLAN_MAX_DEPTH && ((is_drive && depth < DRIVE_SPLIT_DEPTH) || has_excluded);
    if !split {
        out.push((dir.to_path_buf(), RecursiveMode::Recursive));
        return;
    }
    out.push((dir.to_path_buf(), RecursiveMode::NonRecursive));
    for (child, excluded) in children {
        if !excluded {
            plan_dir(&child, depth + 1, is_drive, ex, out);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Filtering and applying events
// ---------------------------------------------------------------------------------------------

/// Cheap first-pass filter, run on notify's thread for every raw event.
fn is_relevant(ev: &Event, scope: &Scope) -> bool {
    if matches!(ev.kind, EventKind::Access(_) | EventKind::Other) {
        return false;
    }
    let rename = matches!(ev.kind, EventKind::Modify(ModifyKind::Name(_)));
    ev.paths.iter().any(|p| {
        if scope.excluded(p) {
            return false;
        }
        // Renames are kept whole: "draft.tmp" → "Report.docx" matters.
        rename
            || !p
                .file_name()
                .is_some_and(|n| is_other_file(&n.to_string_lossy()))
    })
}

#[derive(Debug)]
enum Op {
    Upsert(PathBuf),
    Remove(PathBuf),
    Rename(PathBuf, PathBuf),
}

/// Flattens raw events into operations, pairing Windows' separate rename-from / rename-to.
fn to_ops(events: Vec<Event>) -> Vec<Op> {
    let mut ops = Vec::new();
    let mut pending_from: Option<PathBuf> = None;
    for ev in events {
        let mut paths = ev.paths.into_iter();
        match ev.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                if let Some(from) = paths.next() {
                    if let Some(unpaired) = pending_from.replace(from) {
                        ops.push(Op::Remove(unpaired));
                    }
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                if let Some(to) = paths.next() {
                    ops.push(match pending_from.take() {
                        Some(from) => Op::Rename(from, to),
                        None => Op::Upsert(to),
                    });
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                if let (Some(from), Some(to)) = (paths.next(), paths.next()) {
                    ops.push(Op::Rename(from, to));
                }
            }
            EventKind::Create(_) | EventKind::Modify(_) => ops.extend(paths.map(Op::Upsert)),
            EventKind::Remove(_) => ops.extend(paths.map(Op::Remove)),
            _ => {}
        }
    }
    if let Some(from) = pending_from {
        ops.push(Op::Remove(from)); // moved somewhere we don't watch (e.g. the Recycle Bin)
    }
    ops
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    #[serde(skip)]
    pub new_dirs: Vec<PathBuf>,
    #[serde(skip)]
    pub moved_dirs: Vec<PathBuf>,
}

impl Applied {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

/// The enabled roots plus the exclusion rules: decides whether a path belongs in the index.
pub struct Scope {
    roots: Vec<Root>,
    ex: Exclusions,
}

impl Scope {
    pub fn new(roots: Vec<Root>, ex: Exclusions) -> Self {
        Self {
            roots: roots.into_iter().filter(|r| r.enabled).collect(),
            ex,
        }
    }

    /// The deepest enabled root containing `path`.
    fn root_of(&self, path: &str) -> Option<&Root> {
        self.roots
            .iter()
            .filter(|r| roots::is_within(path, &r.path))
            .max_by_key(|r| r.path.len())
    }

    fn root_id(&self, path: &str) -> Option<i64> {
        self.root_of(path).map(|r| r.id)
    }

    /// Outside every root, or inside an excluded folder below its root.
    pub fn excluded(&self, path: &Path) -> bool {
        match self.root_of(&path.to_string_lossy()) {
            Some(root) => self.ex.is_excluded_below(&root.path, path),
            None => true,
        }
    }

    fn is_excluded_dir(&self, path: &Path) -> bool {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default();
        self.ex.is_excluded_dir(&path.to_string_lossy(), &name)
    }
}

pub struct Applier<'a> {
    pub db: &'a Db,
    pub scope: &'a Scope,
}

/// Work collected while applying one batch of events.
#[derive(Default)]
struct Batch {
    /// Rows that disappeared. Deleted at the end unless something claims them.
    gone: Vec<Indexed>,
    /// Documents that are new to the index, keyed by lower-case path. Resolved at the end so a
    /// move is recognised whatever order Windows reported "added" and "removed" in.
    fresh: HashMap<String, (i64, FileRecord)>,
    out: Applied,
}

impl Applier<'_> {
    pub fn apply(&self, events: Vec<Event>) -> AppResult<Applied> {
        let ops = to_ops(events);
        if ops.is_empty() {
            return Ok(Applied::default());
        }
        let mut conn = self.db.writer();
        let tx = conn.transaction()?;
        let mut b = Batch::default();
        for op in ops {
            match op {
                Op::Rename(from, to) => self.rename(&tx, &from, &to, &mut b)?,
                Op::Remove(path) => self.remove(&tx, &path, &mut b)?,
                Op::Upsert(path) => self.upsert(&tx, &path, &mut b)?,
            }
        }

        let now = now_ms();
        for (_, (root_id, record)) in b.fresh.drain() {
            // Same name and size as something that disappeared in this batch: it was moved.
            let moved = b
                .gone
                .iter()
                .position(|g| g.name.eq_ignore_ascii_case(&record.name) && g.size == record.size);
            match moved {
                Some(i) => {
                    let row = b.gone.swap_remove(i);
                    files::update_batch(&tx, now, &[(row.id, record)])?;
                    b.out.updated += 1;
                }
                None => {
                    files::insert_batch(&tx, root_id, now, &[record])?;
                    b.out.added += 1;
                }
            }
        }
        let ids: Vec<i64> = b.gone.iter().map(|g| g.id).collect();
        b.out.removed += files::delete_ids(&tx, &ids)? as u64;
        tx.commit()?;
        Ok(b.out)
    }

    fn rename(&self, tx: &Transaction, from: &Path, to: &Path, b: &mut Batch) -> AppResult<()> {
        let from_s = from.to_string_lossy();
        if let Some(row) = files::find_by_path(tx, &from_s)? {
            // A document was renamed. Same row, if it is still a document we track.
            let record = (!self.scope.excluded(to))
                .then(|| read_record(to))
                .flatten();
            match record {
                Some(record) if self.scope.root_id(&record.path).is_some() => {
                    files::update_batch(tx, now_ms(), &[(row.id, record)])?;
                    b.out.updated += 1;
                }
                _ => b.gone.push(row), // e.g. Office renaming the original to ~WRL0002.tmp
            }
            return Ok(());
        }
        let inside = files::files_under(tx, &from_s)?;
        if !inside.is_empty() {
            // A folder was renamed or moved.
            b.out.moved_dirs.push(from.to_path_buf());
            let to_s = to.to_string_lossy();
            if !self.scope.excluded(to) && !self.scope.is_excluded_dir(to) {
                b.out.updated += files::move_prefix(tx, &from_s, &to_s)? as u64;
            } else {
                b.gone.extend(inside);
            }
            return Ok(());
        }
        // Not something we tracked: maybe it just became a document ("draft.tmp" → "x.docx")
        // or a folder of documents was moved in.
        self.upsert(tx, to, b)
    }

    fn remove(&self, tx: &Transaction, path: &Path, b: &mut Batch) -> AppResult<()> {
        let path_s = path.to_string_lossy();
        b.fresh.retain(|p, _| !roots::is_within(p, &path_s)); // created and deleted again
        if let Some(row) = files::find_by_path(tx, &path_s)? {
            b.gone.push(row);
            return Ok(());
        }
        let inside = files::files_under(tx, &path_s)?;
        if !inside.is_empty() {
            b.out.moved_dirs.push(path.to_path_buf());
            b.gone.extend(inside);
        }
        Ok(())
    }

    fn upsert(&self, tx: &Transaction, path: &Path, b: &mut Batch) -> AppResult<()> {
        if self.scope.excluded(path) {
            return Ok(());
        }
        let Ok(md) = fs::symlink_metadata(path) else {
            // Already gone again (short-lived file).
            return self.remove(tx, path, b);
        };
        if md.is_dir() {
            if self.scope.is_excluded_dir(path) {
                return Ok(());
            }
            b.out.new_dirs.push(path.to_path_buf());
            for record in self.walk(path) {
                self.place(tx, record, b)?;
            }
            return Ok(());
        }
        if !md.is_file() {
            return Ok(());
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if let Some(record) = to_record(path, name, || Some(md)) {
            self.place(tx, record, b)?;
        }
        Ok(())
    }

    /// A document seen on disk: refresh its row, or remember it as new for the end of the batch.
    fn place(&self, tx: &Transaction, record: FileRecord, b: &mut Batch) -> AppResult<()> {
        let Some(root_id) = self.scope.root_id(&record.path) else {
            return Ok(());
        };
        if let Some(row) = files::find_by_path(tx, &record.path)? {
            b.gone.retain(|g| g.id != row.id); // "removed" earlier in this batch, but it is back
            if row.size != record.size
                || row.modified_at != record.modified_at
                || row.name != record.name
            {
                files::update_batch(tx, now_ms(), &[(row.id, record)])?;
                b.out.updated += 1;
            }
            return Ok(());
        }
        b.fresh
            .insert(record.path.to_lowercase(), (root_id, record));
        Ok(())
    }

    /// Documents inside a folder that appeared (moved or copied in).
    fn walk(&self, dir: &Path) -> Vec<FileRecord> {
        let mut found = Vec::new();
        let walk = WalkDir::new(dir)
            .skip_hidden(false)
            .follow_links(false)
            .parallelism(Parallelism::Serial);
        for entry in walk.into_iter().flatten() {
            let path = entry.path();
            if entry.file_type().is_dir() || self.scope.excluded(&path) {
                continue;
            }
            if entry.file_type().is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if let Some(record) = to_record(&path, name, || entry.metadata().ok()) {
                    found.push(record);
                }
            }
        }
        found
    }
}

fn read_record(path: &Path) -> Option<FileRecord> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    to_record(path, name, || fs::metadata(path).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::scanner;
    use notify::event::{CreateKind, RemoveKind};
    use std::sync::atomic::AtomicBool;

    struct Fixture {
        _tmp: tempfile::TempDir,
        root: PathBuf,
        db: Db,
        scope: Scope,
    }

    impl Fixture {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let root = tmp.path().join("docs");
            fs::create_dir_all(root.join("Work")).unwrap();
            fs::write(root.join("Work").join("Report.pdf"), b"v1").unwrap();
            fs::write(root.join("Budget.xlsx"), b"numbers").unwrap();
            let db = Db::open(&tmp.path().join("w.db")).unwrap();
            {
                let mut conn = db.writer();
                roots::add_root(&mut conn, &root.to_string_lossy()).unwrap();
                roots::add_exclusion(&conn, "node_modules").unwrap();
            }
            scanner::scan(&db, &AtomicBool::new(false), ScanMode::Foreground, |_| {}).unwrap();
            let scope = Scope::new(
                roots::list_roots(&db.reader()).unwrap(),
                Exclusions::new(&["node_modules"]),
            );
            Self {
                _tmp: tmp,
                root,
                db,
                scope,
            }
        }

        fn apply(&self, events: Vec<Event>) -> Applied {
            Applier {
                db: &self.db,
                scope: &self.scope,
            }
            .apply(events)
            .unwrap()
        }

        fn id_of(&self, path: &Path) -> Option<i64> {
            files::find_by_path(&self.db.reader(), &path.to_string_lossy())
                .unwrap()
                .map(|r| r.id)
        }

        fn count(&self) -> i64 {
            files::stats(&self.db.reader()).unwrap().total
        }
    }

    fn ev(kind: EventKind, path: &Path) -> Event {
        Event::new(kind).add_path(path.to_path_buf())
    }
    fn created(p: &Path) -> Event {
        ev(EventKind::Create(CreateKind::Any), p)
    }
    fn removed(p: &Path) -> Event {
        ev(EventKind::Remove(RemoveKind::Any), p)
    }
    fn modified(p: &Path) -> Event {
        ev(EventKind::Modify(ModifyKind::Any), p)
    }
    fn rename_from(p: &Path) -> Event {
        ev(EventKind::Modify(ModifyKind::Name(RenameMode::From)), p)
    }
    fn rename_to(p: &Path) -> Event {
        ev(EventKind::Modify(ModifyKind::Name(RenameMode::To)), p)
    }

    #[test]
    fn new_modified_and_deleted_documents() {
        let f = Fixture::new();
        let new = f.root.join("Notes.docx");
        fs::write(&new, b"hello").unwrap();
        assert_eq!(f.apply(vec![created(&new)]).added, 1);

        fs::write(&new, b"hello, longer now").unwrap();
        assert_eq!(f.apply(vec![modified(&new)]).updated, 1);

        fs::remove_file(&new).unwrap();
        assert_eq!(f.apply(vec![removed(&new)]).removed, 1);
        assert_eq!(f.count(), 2);
    }

    #[test]
    fn rename_keeps_the_same_row() {
        let f = Fixture::new();
        let old = f.root.join("Budget.xlsx");
        let id = f.id_of(&old).unwrap();
        let new = f.root.join("Budget 2026.xlsx");
        fs::rename(&old, &new).unwrap();
        f.apply(vec![rename_from(&old), rename_to(&new)]);
        assert_eq!(f.id_of(&new), Some(id));
        assert_eq!(f.id_of(&old), None);
    }

    #[test]
    fn office_safe_save_keeps_the_same_row() {
        let f = Fixture::new();
        let doc = f.root.join("Work").join("Report.pdf");
        let id = f.id_of(&doc).unwrap();
        let backup = f.root.join("Work").join("~WRL0002.tmp");
        let temp = f.root.join("Work").join("~WRL0001.tmp");
        // original → backup name, new content written to temp, temp → original name
        fs::rename(&doc, &backup).unwrap();
        fs::write(&temp, b"v2 with more text").unwrap();
        fs::rename(&temp, &doc).unwrap();
        fs::remove_file(&backup).unwrap();
        let applied = f.apply(vec![
            rename_from(&doc),
            rename_to(&backup),
            created(&temp),
            rename_from(&temp),
            rename_to(&doc),
            removed(&backup),
        ]);
        assert_eq!(f.id_of(&doc), Some(id));
        assert_eq!(applied.removed, 0);
        assert_eq!(f.count(), 2);
    }

    #[test]
    fn move_to_another_folder_keeps_the_same_row() {
        let f = Fixture::new();
        let old = f.root.join("Budget.xlsx");
        let id = f.id_of(&old).unwrap();
        let new = f.root.join("Work").join("Budget.xlsx");
        fs::rename(&old, &new).unwrap();
        // Moves across folders arrive as remove + create.
        f.apply(vec![removed(&old), created(&new)]);
        assert_eq!(f.id_of(&new), Some(id));
    }

    #[test]
    fn move_into_new_folder_keeps_the_same_row_in_any_event_order() {
        let f = Fixture::new();
        let old = f.root.join("Budget.xlsx");
        let id = f.id_of(&old).unwrap();
        let dir = f.root.join("Moved Here");
        fs::create_dir(&dir).unwrap();
        let new = dir.join("Budget.xlsx");
        fs::rename(&old, &new).unwrap();
        // Windows reported the new folder first, then the removal, then the file.
        let applied = f.apply(vec![created(&dir), removed(&old), created(&new)]);
        assert_eq!(f.id_of(&new), Some(id));
        assert_eq!((applied.added, applied.removed), (0, 0));
    }

    #[test]
    fn folder_rename_moves_everything_inside() {
        let f = Fixture::new();
        let report = f.root.join("Work").join("Report.pdf");
        let id = f.id_of(&report).unwrap();
        let new_dir = f.root.join("Office");
        fs::rename(f.root.join("Work"), &new_dir).unwrap();
        let applied = f.apply(vec![rename_from(&f.root.join("Work")), rename_to(&new_dir)]);
        assert_eq!(f.id_of(&new_dir.join("Report.pdf")), Some(id));
        assert_eq!(applied.moved_dirs, [f.root.join("Work")]);
    }

    #[test]
    fn folder_moved_in_is_indexed() {
        let f = Fixture::new();
        let incoming = f.root.join("Incoming");
        fs::create_dir_all(incoming.join("Sub")).unwrap();
        fs::write(incoming.join("a.pdf"), b"a").unwrap();
        fs::write(incoming.join("Sub").join("b.pptx"), b"b").unwrap();
        let applied = f.apply(vec![created(&incoming)]);
        assert_eq!(applied.added, 2);
        assert_eq!(applied.new_dirs, [incoming]);
    }

    #[test]
    fn excluded_and_irrelevant_paths_are_ignored() {
        let f = Fixture::new();
        let nm = f.root.join("node_modules");
        fs::create_dir_all(&nm).unwrap();
        fs::write(nm.join("readme.pdf"), b"x").unwrap();
        assert!(!f
            .apply(vec![created(&nm.join("readme.pdf")), created(&nm)])
            .changed());
        assert!(!is_relevant(&created(&nm.join("readme.pdf")), &f.scope));
        assert!(!is_relevant(&created(&f.root.join("cache.tmp")), &f.scope));
        assert!(is_relevant(&created(&f.root.join("New folder")), &f.scope));
    }

    #[test]
    fn deleting_a_folder_removes_its_documents() {
        let f = Fixture::new();
        fs::remove_dir_all(f.root.join("Work")).unwrap();
        let applied = f.apply(vec![removed(&f.root.join("Work"))]);
        assert_eq!(applied.removed, 1);
        assert_eq!(f.count(), 1);
    }

    #[test]
    fn plan_skips_excluded_trees() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        for d in ["Documents", "AppData/Local", "Downloads"] {
            fs::create_dir_all(home.join(d)).unwrap();
        }
        let ex = Exclusions::new(&["AppData"]);
        let plan = plan_watches(&home, &ex);
        assert!(plan.contains(&(home.clone(), RecursiveMode::NonRecursive)));
        assert!(plan.contains(&(home.join("Documents"), RecursiveMode::Recursive)));
        assert!(plan.contains(&(home.join("Downloads"), RecursiveMode::Recursive)));
        assert!(!plan
            .iter()
            .any(|(p, _)| p.starts_with(home.join("AppData"))));
    }
}
