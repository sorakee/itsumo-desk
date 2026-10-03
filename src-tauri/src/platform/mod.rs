//! OS access behind traits, so the rest of the core stays portable (D1). Windows is the only
//! implementation in v1; no other module touches the `windows` crate.

#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use self::windows::SystemCursor;

#[cfg(windows)]
use tauri::WebviewWindow;

/// Physical pixels on the virtual desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("OS call failed: {0}")]
    Os(String),
}

pub trait CursorSource: Send + Sync + 'static {
    /// The global cursor position. Fails while the secure desktop (lock screen, UAC) is up.
    fn cursor_position(&self) -> Result<ScreenPoint, PlatformError>;
}

/// Window operations Tauri does not offer.
pub trait NativeWindow {
    /// Moves and resizes the window in one step, in physical pixels. Separate size and
    /// position calls show a frame of the new size at the old position, which flickers.
    fn set_outer_bounds(&self, origin: ScreenPoint, size: (u32, u32)) -> Result<(), PlatformError>;
}

#[cfg(windows)]
impl NativeWindow for WebviewWindow {
    fn set_outer_bounds(&self, origin: ScreenPoint, size: (u32, u32)) -> Result<(), PlatformError> {
        let hwnd = self
            .hwnd()
            .map_err(|error| PlatformError::Os(error.to_string()))?;
        self::windows::set_outer_bounds(hwnd, origin, size)
    }
}
