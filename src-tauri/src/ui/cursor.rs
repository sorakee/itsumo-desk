//! Polls the global cursor for the companion. The webview gets no mouse events outside its
//! own bounds, or at all while it is click-through, so gaze and hit testing run on this.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::watch;
use tracing::{debug, warn};

use crate::{
    events::CursorMoved,
    platform::{CursorSource, ScreenPoint},
};

/// Fast enough for gaze to look smooth and click-through to keep up with the hand.
const ACTIVE_INTERVAL: Duration = Duration::from_millis(33);
/// A still cursor only needs noticing when it starts moving again.
const IDLE_INTERVAL: Duration = Duration::from_millis(100);
/// How long after the last movement the poll stays at the active rate.
const ACTIVE_FOR: Duration = Duration::from_secs(1);

/// Where the companion's client area is, which turns screen pixels into CSS pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Geometry {
    /// Top-left of the client area, physical pixels on the virtual desktop.
    pub origin: ScreenPoint,
    pub scale_factor: f64,
}

impl Geometry {
    fn to_client(self, point: ScreenPoint) -> CursorMoved {
        CursorMoved {
            x: f64::from(point.x - self.origin.x) / self.scale_factor,
            y: f64::from(point.y - self.origin.y) / self.scale_factor,
        }
    }
}

/// Feeds the poll the companion's geometry; `None` pauses it while the companion is hidden.
pub struct CursorTracker(watch::Sender<Option<Geometry>>);

impl CursorTracker {
    pub fn set_geometry(&self, geometry: Option<Geometry>) {
        self.0.send_if_modified(|current| {
            let changed = *current != geometry;
            *current = geometry;
            changed
        });
    }
}

/// Starts the poll and registers the [`CursorTracker`] that drives it.
pub fn spawn(app: &AppHandle, source: impl CursorSource, target: &'static str) {
    let (tx, rx) = watch::channel(None);
    app.manage(CursorTracker(tx));
    tauri::async_runtime::spawn(run(app.clone(), source, target, rx));
}

async fn run(
    app: AppHandle,
    source: impl CursorSource,
    target: &'static str,
    mut geometry: watch::Receiver<Option<Geometry>>,
) {
    let mut last: Option<CursorMoved> = None;
    let mut last_move = Instant::now();
    let mut failing = false;
    loop {
        if geometry.borrow().is_none() {
            // Report the position afresh once the companion is back.
            last = None;
        }
        let current = match geometry.wait_for(Option::is_some).await {
            Ok(current) => *current,
            Err(_) => return,
        };
        let Some(current) = current else { continue };

        match source.cursor_position() {
            Ok(point) => {
                failing = false;
                let moved = current.to_client(point);
                if last != Some(moved) {
                    last = Some(moved);
                    last_move = Instant::now();
                    if let Err(error) = moved.emit_to(&app, target) {
                        warn!(%error, "failed to emit cursor position");
                    }
                }
            }
            Err(error) => {
                if !failing {
                    debug!(%error, "cursor position unavailable");
                    failing = true;
                }
            }
        }

        let interval = if last_move.elapsed() < ACTIVE_FOR {
            ACTIVE_INTERVAL
        } else {
            IDLE_INTERVAL
        };
        tokio::time::sleep(interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_points_become_css_pixels_relative_to_the_client_area() {
        let geometry = Geometry {
            origin: ScreenPoint { x: -1500, y: 200 },
            scale_factor: 1.5,
        };
        let moved = geometry.to_client(ScreenPoint { x: -1200, y: 140 });
        assert_eq!(moved, CursorMoved { x: 200.0, y: -40.0 });
    }
}
