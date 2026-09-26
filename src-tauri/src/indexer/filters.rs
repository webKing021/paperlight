//! What counts as a document, and which folders are never worth walking.

/// Indexed extensions and the document kind each one maps to.
const EXTENSIONS: &[(&str, &str)] = &[
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
];

/// Returns the document kind for a lower-case extension, or `None` if it is not indexed.
pub fn kind_for_ext(ext: &str) -> Option<&'static str> {
    EXTENSIONS
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, kind)| *kind)
}

/// Office lock/temp files that appear next to open documents.
pub fn is_ignored_file(name: &str) -> bool {
    name.starts_with("~$") || name.starts_with(".~lock") || name.starts_with("~WRL")
}

/// Seeded into the `exclusions` table on first run; users can edit them later.
/// `?:\` matches any drive letter; a bare name matches a folder with that name anywhere.
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
            let p = p.as_ref().trim().replace('/', "\\");
            let p = p.trim_end_matches('\\').to_lowercase();
            if p.is_empty() {
                continue;
            }
            if p.contains('\\') || p.contains(':') {
                ex.prefixes.push(p);
            } else {
                ex.names.push(p);
            }
        }
        ex
    }

    /// `path` is the full folder path, `name` its last component.
    pub fn is_excluded_dir(&self, path: &str, name: &str) -> bool {
        if name.starts_with('$') || name.starts_with('.') {
            return true;
        }
        let name = name.to_lowercase();
        if self.names.contains(&name) {
            return true;
        }
        let path = path.to_lowercase();
        self.prefixes.iter().any(|prefix| {
            let (path, prefix) = match prefix.strip_prefix('?') {
                // Any drive: compare everything after the drive letter.
                Some(rest) => match path.get(1..) {
                    Some(p) => (p, rest),
                    None => return false,
                },
                None => (path.as_str(), prefix.as_str()),
            };
            path == prefix
                || (path.len() > prefix.len()
                    && path.starts_with(prefix)
                    && path.as_bytes()[prefix.len()] == b'\\')
        })
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
        assert_eq!(kind_for_ext("txt"), None);
    }

    #[test]
    fn ignores_office_lock_files() {
        assert!(is_ignored_file("~$Budget.xlsx"));
        assert!(!is_ignored_file("Budget.xlsx"));
    }

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

    #[test]
    fn excludes_absolute_prefix() {
        let ex = Exclusions::new(&["D:\\Archive\\Old"]);
        assert!(ex.is_excluded_dir("D:\\Archive\\Old", "Old"));
        assert!(ex.is_excluded_dir("d:\\archive\\old\\2019", "2019"));
        assert!(!ex.is_excluded_dir("D:\\Archive\\Older", "Older"));
    }
}
