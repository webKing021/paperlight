//! Putting a file (not its path as text) on the clipboard, so it can be pasted into a
//! folder, an email or a chat just like a file copied in Explorer.

use std::path::Path;

use crate::error::{AppError, AppResult};

#[cfg(windows)]
pub fn copy_file(path: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    /// Clipboard format for a list of files (what Explorer puts there on Ctrl+C).
    const CF_HDROP: u32 = 15;

    /// Header of a CF_HDROP block; the double-NUL-terminated list of wide paths follows it.
    #[repr(C)]
    struct DropFiles {
        files_offset: u32,
        x: i32,
        y: i32,
        non_client: i32,
        wide: i32,
    }

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.extend([0, 0]);
    let header = std::mem::size_of::<DropFiles>();
    let bytes = header + wide.len() * 2;
    let failed = || AppError::msg("Windows would not accept the file on the clipboard.");

    // SAFETY: the block is allocated with room for the header and the path list, written
    // while locked, and either handed to the clipboard (which then owns it) or freed.
    unsafe {
        let block = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if block.is_null() {
            return Err(failed());
        }
        let ptr = GlobalLock(block) as *mut u8;
        if ptr.is_null() {
            GlobalFree(block);
            return Err(failed());
        }
        ptr.cast::<DropFiles>().write_unaligned(DropFiles {
            files_offset: header as u32,
            x: 0,
            y: 0,
            non_client: 0,
            wide: 1,
        });
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr.add(header).cast::<u16>(), wide.len());
        GlobalUnlock(block);

        // Another app can hold the clipboard for a moment; try a few times.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            GlobalFree(block);
            return Err(AppError::msg(
                "The clipboard is busy in another app. Try again.",
            ));
        }
        EmptyClipboard();
        let set = SetClipboardData(CF_HDROP, block);
        CloseClipboard();
        if set.is_null() {
            GlobalFree(block);
            return Err(failed());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn copy_file(_path: &Path) -> AppResult<()> {
    Err(AppError::msg(
        "Copying a file to the clipboard isn't available on this system yet. Drag it instead.",
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Replaces whatever is on the clipboard, so it only runs when asked:
    /// `cargo test copies_a_file_to_the_clipboard -- --ignored`
    #[test]
    #[ignore]
    fn copies_a_file_to_the_clipboard() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Clipboard test.pdf");
        std::fs::write(&file, b"x").unwrap();
        copy_file(&file).unwrap();
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "(Get-Clipboard -Format FileDropList).FullName",
            ])
            .output()
            .unwrap();
        let listed = String::from_utf8_lossy(&out.stdout);
        assert!(listed.contains("Clipboard test.pdf"), "{listed}");
    }
}
