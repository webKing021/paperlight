//! Keeps automatic scans polite: Windows "background mode" lowers a thread's CPU *and* disk
//! I/O priority, so indexing never competes with what the user is doing.

use std::sync::Arc;

use jwalk::rayon::{ThreadPool, ThreadPoolBuilder};

/// Upper bound on walker threads; directory listing is I/O-bound, more threads don't help.
const MAX_WALK_THREADS: usize = 4;

#[cfg(windows)]
pub fn enter_background() {
    use windows_sys::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
    };
    // SAFETY: affects only the calling thread; the pseudo-handle needs no cleanup.
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN);
    }
}

#[cfg(windows)]
pub fn leave_background() {
    use windows_sys::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_END,
    };
    // SAFETY: as above.
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END);
    }
}

#[cfg(not(windows))]
pub fn enter_background() {}

#[cfg(not(windows))]
pub fn leave_background() {}

/// Builds the walker pool: at most 4 threads (half the cores on small machines), optionally
/// running in background mode.
pub fn walker_pool(background: bool) -> std::io::Result<Arc<ThreadPool>> {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    let threads = (cores / 2).clamp(1, MAX_WALK_THREADS);
    let mut builder = ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|i| format!("paperlight-walk-{i}"));
    if background {
        builder = builder.start_handler(|_| enter_background());
    }
    builder.build().map(Arc::new).map_err(std::io::Error::other)
}
