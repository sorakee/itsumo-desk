//! Where the companion window opens: the saved position if it is still on a connected
//! monitor, otherwise the bottom-right corner of the primary monitor's work area.

use crate::settings::WindowPosition;

/// Physical pixels on the virtual desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// How much of the window, per axis, must overlap a work area for a saved position to
/// count as reachable. Enough to grab and drag it back.
const MIN_VISIBLE: i64 = 64;

pub fn initial_position(
    saved: Option<WindowPosition>,
    window_size: (u32, u32),
    work_areas: &[Rect],
    primary: Option<Rect>,
) -> Option<WindowPosition> {
    let (width, height) = window_size;
    if let Some(position) = saved {
        let window = Rect {
            x: position.x,
            y: position.y,
            width,
            height,
        };
        if work_areas.iter().any(|area| is_reachable(window, *area)) {
            return Some(position);
        }
    }
    primary.map(|area| bottom_right(area, window_size))
}

fn is_reachable(window: Rect, area: Rect) -> bool {
    let min_x = MIN_VISIBLE.min(i64::from(window.width));
    let min_y = MIN_VISIBLE.min(i64::from(window.height));
    overlap(window.x, window.width, area.x, area.width) >= min_x
        && overlap(window.y, window.height, area.y, area.height) >= min_y
}

fn overlap(a_start: i32, a_len: u32, b_start: i32, b_len: u32) -> i64 {
    let start = i64::from(a_start).max(i64::from(b_start));
    let end = (i64::from(a_start) + i64::from(a_len)).min(i64::from(b_start) + i64::from(b_len));
    (end - start).max(0)
}

/// Pins the window to the area's bottom-right corner; if the window is larger than the
/// area, its top-left corner stays inside instead.
fn bottom_right(area: Rect, (width, height): (u32, u32)) -> WindowPosition {
    let x = i64::from(area.x) + i64::from(area.width) - i64::from(width);
    let y = i64::from(area.y) + i64::from(area.height) - i64::from(height);
    WindowPosition {
        x: clamp_to_i32(x.max(i64::from(area.x))),
        y: clamp_to_i32(y.max(i64::from(area.y))),
    }
}

fn clamp_to_i32(value: i64) -> i32 {
    i32::try_from(value).unwrap_or(if value < 0 { i32::MIN } else { i32::MAX })
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: (u32, u32) = (480, 640);

    // Primary 1920×1080 with a 48 px taskbar; a second monitor to its left.
    const PRIMARY: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1032,
    };
    const LEFT: Rect = Rect {
        x: -2560,
        y: -200,
        width: 2560,
        height: 1400,
    };

    fn at(x: i32, y: i32) -> Option<WindowPosition> {
        Some(WindowPosition { x, y })
    }

    #[test]
    fn first_run_goes_bottom_right_of_primary() {
        let position = initial_position(None, WINDOW, &[PRIMARY, LEFT], Some(PRIMARY));
        assert_eq!(position, at(1440, 392));
    }

    #[test]
    fn saved_position_on_a_secondary_monitor_is_kept() {
        let position = initial_position(at(-1500, 100), WINDOW, &[PRIMARY, LEFT], Some(PRIMARY));
        assert_eq!(position, at(-1500, 100));
    }

    #[test]
    fn saved_position_on_a_disconnected_monitor_falls_back() {
        let position = initial_position(at(-1500, 100), WINDOW, &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, at(1440, 392));
    }

    #[test]
    fn mostly_off_screen_but_grabbable_is_kept() {
        // 100 px of the window still inside the right edge.
        let position = initial_position(at(1820, 200), WINDOW, &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, at(1820, 200));
    }

    #[test]
    fn a_sliver_on_screen_falls_back() {
        let position = initial_position(at(1900, 200), WINDOW, &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, at(1440, 392));
    }

    #[test]
    fn minimised_position_falls_back() {
        // Windows parks minimised windows at -32000, -32000.
        let position = initial_position(at(-32000, -32000), WINDOW, &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, at(1440, 392));
    }

    #[test]
    fn window_larger_than_work_area_stays_inside_top_left() {
        let small = Rect {
            x: 0,
            y: 0,
            width: 400,
            height: 600,
        };
        assert_eq!(
            initial_position(None, WINDOW, &[small], Some(small)),
            at(0, 0)
        );
    }

    #[test]
    fn no_monitors_leaves_the_default() {
        assert_eq!(initial_position(None, WINDOW, &[], None), None);
    }
}
