//! What counts as a document, and which folders are never worth walking.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::Connection;

use crate::db::roots;
use crate::error::AppResult;
use crate::paths::SEP;

/// Indexed extensions and the document kind each one maps to.
pub const EXTENSIONS: &[(&str, &str)] = &[
    ("pdf", "pdf"),
    ("doc", "word"),
    ("docx", "word"),
    ("docm", "word"),
    ("dot", "word"),
    ("dotx", "word"),
    ("odt", "word"),
    ("rtf", "word"),
    ("xls", "excel"),
    ("xlsx", "excel"),
    ("xlsm", "excel"),
    ("xlsb", "excel"),
    ("csv", "excel"),
    ("ods", "excel"),
    ("ppt", "slides"),
    ("pptx", "slides"),
    ("pptm", "slides"),
    ("pps", "slides"),
    ("ppsx", "slides"),
    ("odp", "slides"),
    ("txt", "text"),
    ("md", "text"),
];

/// Formats that are only indexed once the user turns them on. Plain-text files are
/// everywhere (licences, logs, READMEs), so they would drown the documents by default.
pub const OPT_IN: &[&str] = &["txt", "md"];

/// Returns the document kind for a lower-case extension, or `None` if it is not indexed.
pub fn kind_for_ext(ext: &str) -> Option<&'static str> {
    EXTENSIONS
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, kind)| *kind)
}

/// Settings key holding the extensions the user chose not to index (comma-separated).
const DISABLED_KEY: &str = "disabled_formats";
/// Settings key holding the [`OPT_IN`] extensions the user turned on (comma-separated).
const OPTED_IN_KEY: &str = "opted_in_formats";

/// Which extensions are indexed. Ordinary formats are stored as the *disabled* ones, so a
/// format added in a later version is indexed by default; [`OPT_IN`] formats are stored as
/// the ones turned *on*, so they stay off until chosen.
#[derive(Debug, Clone)]
pub struct Formats {
    /// Every extension that is not indexed.
    disabled: HashSet<String>,
}

impl Default for Formats {
    /// Everything on except the opt-in formats.
    fn default() -> Self {
        Self {
            disabled: OPT_IN.iter().map(|e| e.to_string()).collect(),
        }
    }
}

impl Formats {
    /// From the complete list of extensions that should not be indexed.
    pub fn new<S: AsRef<str>>(disabled: &[S]) -> Self {
        Self {
            disabled: disabled
                .iter()
                .map(|e| e.as_ref().trim().to_ascii_lowercase())
                .filter(|e| kind_for_ext(e).is_some())
                .collect(),
        }
    }

    pub fn load(conn: &Connection) -> AppResult<Self> {
        let list = |key: &str| -> AppResult<Vec<String>> {
            let raw = roots::get_setting(conn, key)?.unwrap_or_default();
            Ok(raw
                .split(',')
                .filter(|e| !e.is_empty())
                .map(str::to_string)
                .collect())
        };
        let mut disabled = list(DISABLED_KEY)?;
        disabled.retain(|e| !OPT_IN.contains(&e.as_str()));
        let opted_in = list(OPTED_IN_KEY)?;
        disabled.extend(
            OPT_IN
                .iter()
                .filter(|e| !opted_in.iter().any(|o| o == *e))
                .map(|e| e.to_string()),
        );
        Ok(Self::new(&disabled))
    }

    pub fn save(&self, conn: &Connection) -> AppResult<()> {
        let (opt, normal): (Vec<String>, Vec<String>) = self
            .disabled_list()
            .into_iter()
            .partition(|e| OPT_IN.contains(&e.as_str()));
        let opted_in: Vec<&str> = OPT_IN
            .iter()
            .copied()
            .filter(|e| !opt.iter().any(|o| o == e))
            .collect();
        roots::set_setting(conn, DISABLED_KEY, &normal.join(","))?;
        roots::set_setting(conn, OPTED_IN_KEY, &opted_in.join(","))
    }

    /// Every extension that is not indexed, in a stable order.
    pub fn disabled_list(&self) -> Vec<String> {
        let mut v: Vec<String> = self.disabled.iter().cloned().collect();
        v.sort();
        v
    }

    pub fn is_enabled(&self, ext: &str) -> bool {
        !self.disabled.contains(ext)
    }

    /// The kind of a lower-case extension, if it is a document format the user wants indexed.
    pub fn kind(&self, ext: &str) -> Option<&'static str> {
        kind_for_ext(ext).filter(|_| self.is_enabled(ext))
    }
}

/// Office lock/temp files that appear next to open documents.
pub fn is_ignored_file(name: &str) -> bool {
    name.starts_with("~$") || name.starts_with(".~lock") || name.starts_with("~WRL")
}

/// Seeded into the `exclusions` table on first run; users can edit them later.
/// `?:\` matches any drive letter; a bare name matches a folder with that name anywhere.
#[cfg(windows)]
pub const DEFAULT_EXCLUSIONS: &[&str] = &[
    "?:\\Windows",
    "?:\\Windows.old",
    "?:\\Program Files",
    "?:\\Program Files (x86)",
    "?:\\ProgramData",
    "?:\\Recovery",
    "?:\\PerfLogs",
    "?:\\System Volume Information",
    "AppData",
    "node_modules",
    "__pycache__",
    "site-packages",
    "venv",
];

/// Seeded into the `exclusions` table on first run; users can edit them later. A path covers
/// that folder and everything in it; a bare name matches a folder with that name anywhere.
/// (Dot-folders such as `.cache`, `.config` and `.local` are always skipped anyway.)
#[cfg(not(windows))]
pub const DEFAULT_EXCLUSIONS: &[&str] = &[
    "/proc",
    "/sys",
    "/dev",
    "/run",
    "/tmp",
    "/snap",
    "/usr",
    "/var",
    "/boot",
    "/lost+found",
    "snap",
    "node_modules",
    "__pycache__",
    "site-packages",
    "venv",
];

/// Compiled exclusion rules. Folders starting with `$` (`$Recycle.Bin`, `$WinREAgent`…) and
/// dot-folders (`.git`, `.cache`…) are always skipped.
#[derive(Debug, Default)]
pub struct Exclusions {
    names: Vec<String>,
    prefixes: Vec<String>,
}

impl Exclusions {
    pub fn new<S: AsRef<str>>(patterns: &[S]) -> Self {
        let mut ex = Self::default();
        for p in patterns {
            let p = p.as_ref().trim();
            // Windows accepts either slash; elsewhere `\` is an ordinary character.
            let p = if cfg!(windows) {
                p.replace('/', "\\")
            } else {
                p.to_string()
            };
            let p = match p.trim_end_matches(SEP) {
                "" if p.starts_with(SEP) => continue, // the root itself can't be excluded
                trimmed => trimmed.to_lowercase(),
            };
            if p.is_empty() {
                continue;
            }
            if p.contains(SEP) || (cfg!(windows) && p.contains(':')) {
                ex.prefixes.push(p);
            } else {
                ex.names.push(p);
            }
        }
        ex
    }

    /// `path` is the full folder path, `name` its last component.
    #[cfg(test)]
    pub fn is_excluded_dir(&self, path: &str, name: &str) -> bool {
        self.excluded_dir(None, path, name)
    }

    /// Like `is_excluded_dir`, for a folder inside the location `root`. A path rule that
    /// covers the location itself is ignored: a folder the user chose explicitly is always
    /// indexed, even if it lies inside an excluded one (say a location under `/var`).
    pub fn is_excluded_dir_in(&self, root: &str, path: &str, name: &str) -> bool {
        let root = root.trim_end_matches(SEP).to_lowercase();
        self.excluded_dir(Some(&root), path, name)
    }

    fn excluded_dir(&self, root: Option<&str>, path: &str, name: &str) -> bool {
        if name.starts_with('$') || name.starts_with('.') {
            return true;
        }
        let name = name.to_lowercase();
        if self.names.contains(&name) {
            return true;
        }
        let path = path.to_lowercase();
        self.prefixes
            .iter()
            .any(|prefix| covers(prefix, &path) && !root.is_some_and(|r| covers(prefix, r)))
    }

    /// True if a folder between `root` and `path` is excluded. Folders *above* the root are
    /// never considered: a location the user chose explicitly is always honoured. The last
    /// component of `path` is not checked either, since it may be a file.
    pub fn is_excluded_below(&self, root: &str, path: &Path) -> bool {
        let location = root;
        let root = root.trim_end_matches(SEP);
        let full = path.to_string_lossy();
        if full.len() <= root.len() || !full.is_char_boundary(root.len()) {
            return false;
        }
        let mut current = full[..root.len()].to_string();
        let parts: Vec<&str> = full[root.len()..]
            .split(SEP)
            .filter(|p| !p.is_empty())
            .collect();
        for name in &parts[..parts.len().saturating_sub(1)] {
            current.push(SEP);
            current.push_str(name);
            if self.is_excluded_dir_in(location, &current, name) {
                return true;
            }
        }
        false
    }
}

/// True when the lower-case path rule `prefix` covers the lower-case `path`: the folder
/// itself or anything inside it. A rule starting with `?` applies to any drive letter.
fn covers(prefix: &str, path: &str) -> bool {
    let (path, prefix) = match prefix.strip_prefix('?') {
        // Any drive: compare everything after the drive letter.
        Some(rest) => match path.get(1..) {
            Some(p) => (p, rest),
            None => return false,
        },
        None => (path, prefix),
    };
    path == prefix
        || (path.len() > prefix.len()
            && path.starts_with(prefix)
            && path[prefix.len()..].starts_with(SEP))
}

/// True for names that are clearly some other kind of file (`.tmp`, `.log`, `.jpg`…), used to
/// drop irrelevant file-system events early. Folder names like `v1.2` are not matched.
pub fn is_other_file(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && (1..=5).contains(&ext.len()) => {
            ext.chars().all(|c| c.is_ascii_alphanumeric())
                && ext.chars().any(|c| c.is_ascii_alphabetic())
                && kind_for_ext(&ext.to_ascii_lowercase()).is_none()
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_extensions_to_kinds() {
        assert_eq!(kind_for_ext("pdf"), Some("pdf"));
        assert_eq!(kind_for_ext("docx"), Some("word"));
        assert_eq!(kind_for_ext("xlsx"), Some("excel"));
        assert_eq!(kind_for_ext("pptx"), Some("slides"));
        assert_eq!(kind_for_ext("exe"), None);
        assert_eq!(kind_for_ext("md"), Some("text"));
    }

    #[test]
    fn plain_text_is_indexed_only_when_turned_on() {
        let tmp = tempfile::tempdir().unwrap();
        let db = crate::db::Db::open(&tmp.path().join("f.db")).unwrap();
        let conn = db.writer();
        // A fresh install, and one that saved its formats before txt/md existed.
        assert_eq!(Formats::load(&conn).unwrap().kind("txt"), None);
        roots::set_setting(&conn, DISABLED_KEY, "csv").unwrap();
        let old = Formats::load(&conn).unwrap();
        assert_eq!((old.kind("md"), old.kind("csv")), (None, None));
        assert_eq!(old.kind("pdf"), Some("pdf"));

        // Turning txt on (md stays off) survives a save and load.
        Formats::new(&["csv", "md"]).save(&conn).unwrap();
        let now = Formats::load(&conn).unwrap();
        assert_eq!(now.kind("txt"), Some("text"));
        assert_eq!(now.disabled_list(), ["csv", "md"]);
    }

    #[test]
    fn disabled_formats_are_not_documents() {
        let f = Formats::new(&["CSV", "doc", "exe"]);
        assert_eq!(f.kind("csv"), None);
        assert_eq!(f.kind("doc"), None);
        assert_eq!(f.kind("docx"), Some("word"));
        assert_eq!(f.disabled_list(), ["csv", "doc"]); // unknown extensions are dropped
    }

    #[test]
    fn ignores_office_lock_files() {
        assert!(is_ignored_file("~$Budget.xlsx"));
        assert!(!is_ignored_file("Budget.xlsx"));
    }

    #[cfg(windows)]
    #[test]
    fn excludes_by_name_prefix_and_any_drive() {
        let ex = Exclusions::new(DEFAULT_EXCLUSIONS);
        assert!(ex.is_excluded_dir("C:\\Windows", "Windows"));
        assert!(ex.is_excluded_dir("D:\\Program Files\\App", "App"));
        assert!(ex.is_excluded_dir("C:\\Users\\me\\AppData", "AppData"));
        assert!(ex.is_excluded_dir("D:\\code\\web\\node_modules", "node_modules"));
        assert!(ex.is_excluded_dir("C:\\$Recycle.Bin", "$Recycle.Bin"));
        assert!(ex.is_excluded_dir("D:\\repo\\.git", ".git"));
        assert!(!ex.is_excluded_dir("C:\\Windowsill", "Windowsill"));
        assert!(!ex.is_excluded_dir("C:\\Users\\me\\Documents", "Documents"));
    }

    #[cfg(windows)]
    #[test]
    fn a_location_inside_an_excluded_path_is_still_indexed() {
        let ex = Exclusions::new(DEFAULT_EXCLUSIONS);
        let dir = r"C:\ProgramData\Scans\2024";
        assert!(ex.is_excluded_dir_in(r"C:\", dir, "2024"));
        assert!(!ex.is_excluded_dir_in(r"C:\ProgramData\Scans", dir, "2024"));
        assert!(ex.is_excluded_dir_in(
            r"C:\ProgramData\Scans",
            r"C:\ProgramData\Scans\node_modules",
            "node_modules"
        ));
        assert!(!ex.is_excluded_below(
            r"C:\ProgramData\Scans",
            Path::new(r"C:\ProgramData\Scans\2024\a.pdf")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn excludes_absolute_prefix() {
        let ex = Exclusions::new(&["D:\\Archive\\Old"]);
        assert!(ex.is_excluded_dir("D:\\Archive\\Old", "Old"));
        assert!(ex.is_excluded_dir("d:\\archive\\old\\2019", "2019"));
        assert!(!ex.is_excluded_dir("D:\\Archive\\Older", "Older"));
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_exclusions() {
        let ex = Exclusions::new(DEFAULT_EXCLUSIONS);
        assert!(ex.is_excluded_dir("/proc", "proc"));
        assert!(ex.is_excluded_dir("/usr/share/doc", "doc"));
        assert!(ex.is_excluded_dir("/home/me/web/node_modules", "node_modules"));
        assert!(ex.is_excluded_dir("/home/me/.cache", ".cache"));
        assert!(!ex.is_excluded_dir("/usrdata", "usrdata"));
        assert!(!ex.is_excluded_dir("/home/me/Documents", "Documents"));

        let ex = Exclusions::new(&["/srv/Archive/Old/", "/"]);
        assert!(ex.is_excluded_dir("/srv/archive/old/2019", "2019"));
        assert!(!ex.is_excluded_dir("/srv/Archive/Older", "Older"));
        assert!(!ex.is_excluded_dir("/home", "home")); // "/" alone excludes nothing

        let ex = Exclusions::new(DEFAULT_EXCLUSIONS);
        let below = |root: &str, p: &str| ex.is_excluded_below(root, Path::new(p));
        assert!(below("/", "/usr/share/doc/a.pdf"));
        assert!(below("/home/me", "/home/me/web/node_modules/a/b.pdf"));
        assert!(below("/home/me", "/home/me/.config/x.pdf"));
        assert!(!below("/home/me", "/home/me/Work/.hidden-name.pdf"));
        assert!(!below("/home/me", "/home/me/Work/Report.pdf"));
        // A location the user picked inside an excluded or hidden folder is still honoured.
        assert!(!below("/var/docs", "/var/docs/a.pdf"));
        assert!(!below("/var/docs", "/var/docs/2024/a.pdf"));
        assert!(below("/var/docs", "/var/docs/node_modules/a.pdf"));
        assert!(ex.is_excluded_dir_in("/", "/var/docs/2024", "2024"));
        assert!(!ex.is_excluded_dir_in("/var/docs/", "/var/docs/2024", "2024"));
        assert!(!below(
            "/home/me/.cache/docs",
            "/home/me/.cache/docs/Work/a.pdf"
        ));
        assert!(below(
            "/home/me/.cache/docs",
            "/home/me/.cache/docs/.git/a.pdf"
        ));
    }

    #[cfg(windows)]
    #[test]
    fn checks_folders_between_root_and_file_only() {
        let ex = Exclusions::new(DEFAULT_EXCLUSIONS);
        let below = |root: &str, p: &str| ex.is_excluded_below(root, Path::new(p));
        assert!(below(r"C:\", r"C:\Users\me\AppData\Local\x.pdf"));
        assert!(below(r"D:\", r"D:\web\node_modules\a\b.pdf"));
        assert!(below(r"C:\", r"C:\Windows\x.pdf"));
        assert!(!below(r"D:\", r"D:\Work\.hidden-name.pdf"));
        assert!(!below(r"D:\", r"D:\Work\Report.pdf"));
        // A location the user picked inside an excluded or hidden folder is still honoured.
        assert!(!below(
            r"C:\Users\me\AppData\Notes",
            r"C:\Users\me\AppData\Notes\a.pdf"
        ));
        assert!(!below(
            r"C:\tmp\.cache\docs",
            r"C:\tmp\.cache\docs\Work\a.pdf"
        ));
        assert!(below(
            r"C:\tmp\.cache\docs",
            r"C:\tmp\.cache\docs\.git\a.pdf"
        ));
    }

    #[test]
    fn recognises_other_file_types() {
        assert!(is_other_file("cache.tmp"));
        assert!(is_other_file("photo.JPG"));
        assert!(!is_other_file("Report.pdf"));
        assert!(!is_other_file("Release v1.2"));
        assert!(!is_other_file("Folder"));
    }
}
