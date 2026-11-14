//! Folder-path helpers shared by the index and the watcher.
//!
//! Paths are stored as the OS writes them (`D:\Work\a.pdf` on Windows, `/home/me/a.pdf`
//! elsewhere) and compared case-insensitively everywhere, to match the index's `NOCASE` path
//! column. (On a case-sensitive file system two files whose paths differ only in case
//! therefore share one row; the second one found is not indexed separately.)

/// The platform's path separator.
pub const SEP: char = std::path::MAIN_SEPARATOR;

/// The character that sorts right after [`SEP`] (`]` follows `\`, `0` follows `/`): the upper
/// bound of "every path inside this folder" as an index range.
const AFTER_SEP: char = if cfg!(windows) { ']' } else { '0' };

/// Normalises a folder path for storage. Windows: backslashes, and a drive keeps its trailing
/// `\`. Elsewhere: no trailing `/`, except the root itself.
pub fn normalize_root(path: &str) -> String {
    let p = path.trim();
    if cfg!(windows) {
        let p = p.replace('/', "\\");
        let trimmed = p.trim_end_matches('\\');
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            format!("{trimmed}\\")
        } else {
            trimmed.to_string()
        }
    } else {
        let trimmed = p.trim_end_matches('/');
        if trimmed.is_empty() && p.starts_with('/') {
            "/".to_string()
        } else {
            trimmed.to_string()
        }
    }
}

/// True when `child` is `parent` itself or lies somewhere below it (case-insensitive).
pub fn is_within(child: &str, parent: &str) -> bool {
    let c = child.to_lowercase();
    let c = c.trim_end_matches(SEP);
    let p = parent.to_lowercase();
    let p = p.trim_end_matches(SEP);
    c == p || (c.starts_with(p) && c[p.len()..].starts_with(SEP))
}

/// Bounds selecting every path strictly inside `dir`: `dir<SEP>` <= path < `dir<AFTER_SEP>`.
/// With the path column's `NOCASE` collation this is an index range scan.
pub fn prefix_bounds(dir: &str) -> (String, String) {
    let dir = dir.trim_end_matches(SEP);
    (format!("{dir}{SEP}"), format!("{dir}{AFTER_SEP}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_paths() {
        assert_eq!(normalize_root("D:"), "D:\\");
        assert_eq!(normalize_root("D:\\"), "D:\\");
        assert_eq!(normalize_root("D:/Work/Clients/"), "D:\\Work\\Clients");
        assert!(is_within("D:\\Work\\Acme", "D:\\"));
        assert!(is_within("d:\\work\\acme", "D:\\Work"));
        assert!(is_within("D:\\Work", "D:\\Work"));
        assert!(!is_within("D:\\Workshop", "D:\\Work"));
        assert!(!is_within("C:\\Work", "D:\\"));
        assert_eq!(
            prefix_bounds("D:\\Work\\"),
            ("D:\\Work\\".to_string(), "D:\\Work]".to_string())
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_paths() {
        assert_eq!(normalize_root("/"), "/");
        assert_eq!(normalize_root("/home/me/"), "/home/me");
        assert_eq!(normalize_root(" /home/me/Docs "), "/home/me/Docs");
        assert!(is_within("/home/me/Docs", "/"));
        assert!(is_within("/home/me/docs", "/home/Me"));
        assert!(is_within("/home/me", "/home/me/"));
        assert!(!is_within("/home/meadow", "/home/me"));
        assert!(!is_within("/srv/docs", "/home"));
        assert_eq!(
            prefix_bounds("/home/me"),
            ("/home/me/".to_string(), "/home/me0".to_string())
        );
        assert_eq!(prefix_bounds("/"), ("/".to_string(), "0".to_string()));
    }
}
