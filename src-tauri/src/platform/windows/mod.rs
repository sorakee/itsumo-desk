//! Windows implementations of the platform traits.

use ::windows::Win32::{
    Foundation::{HWND, POINT},
    UI::WindowsAndMessaging::{
        GetCursorPos, SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    },
};

use super::{CursorSource, PlatformError, ScreenPoint};

/// The real cursor. Coordinates are physical because Tauri makes the process per-monitor
/// DPI aware.
pub struct SystemCursor;

impl CursorSource for SystemCursor {
    fn cursor_position(&self) -> Result<ScreenPoint, PlatformError> {
        let mut point = POINT::default();
        // SAFETY: `point` is a live, writable POINT for the whole call, which is all
        // GetCursorPos requires.
        #[allow(unsafe_code)]
        let result = unsafe { GetCursorPos(&mut point) };
        result.map_err(|error| PlatformError::Os(error.to_string()))?;
        Ok(ScreenPoint {
            x: point.x,
            y: point.y,
        })
    }
}

pub(super) fn set_outer_bounds(
    hwnd: HWND,
    origin: ScreenPoint,
    (width, height): (u32, u32),
) -> Result<(), PlatformError> {
    let to_i32 = |value: u32| i32::try_from(value).map_err(|e| PlatformError::Os(e.to_string()));
    let (width, height) = (to_i32(width)?, to_i32(height)?);
    // SAFETY: `hwnd` comes from Tauri for a live window owned by this process, and the flags
    // leave z-order and activation untouched; SetWindowPos has no other preconditions.
    #[allow(unsafe_code)]
    let result = unsafe {
        SetWindowPos(
            hwnd,
            None,
            origin.x,
            origin.y,
            width,
            height,
            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE,
        )
    };
    result.map_err(|error| PlatformError::Os(error.to_string()))
}
