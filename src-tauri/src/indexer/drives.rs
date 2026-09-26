//! Discovers the default places to index on first run.

/// Fixed (internal) drives such as `C:\` and `D:\`. USB sticks, DVD and network drives are
/// left out; users can add them manually.
#[cfg(windows)]
pub fn default_roots() -> Vec<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};

    const DRIVE_FIXED: u32 = 3;
    // SAFETY: plain Win32 queries with no pointers held beyond the call.
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i) as char))
        .filter(|root| {
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
        })
        .collect()
}

#[cfg(not(windows))]
pub fn default_roots() -> Vec<String> {
    std::env::var("HOME").map(|h| vec![h]).unwrap_or_default()
}
