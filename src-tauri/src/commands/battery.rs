//! Battery reading for the low-battery auto mode.
//!
//! The webview's Battery Status API only exists in Chromium (Windows and
//! Android). macOS and Linux run WebKit, so the frontend falls back to this
//! command — backed by the `battery` crate (IOKit on macOS, sysfs on Linux,
//! Win32 on Windows). Targets without a backend report `supported: false`
//! and the mode stays a manual toggle.

use serde::Serialize;

/// One battery reading, polled by the frontend (`settings/battery.ts`).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatus {
    /// Charge level in `0.0..=1.0`, `null` when it cannot be read.
    pub level: Option<f64>,
    /// Whether the battery is (reported as) charging, `null` when unknown.
    pub charging: Option<bool>,
    /// `false` when this target has no battery backend (e.g. Android, or a
    /// desktop machine without a battery) — auto mode stays off.
    pub supported: bool,
}

#[tauri::command]
pub fn battery_status() -> BatteryStatus {
    read_battery().unwrap_or_default()
}

#[cfg(not(target_os = "android"))]
fn read_battery() -> Option<BatteryStatus> {
    use battery::{Manager, State};
    use battery::units::ratio::percent;

    let manager = Manager::new().ok()?;
    let mut batteries = manager.batteries().ok()?;
    // Laptops carry a single battery; the first one reported is the one.
    let battery = batteries.next()?.ok()?;
    let level = f64::from(battery.state_of_charge().get::<percent>()) / 100.0;
    let charging = matches!(battery.state(), State::Charging | State::Full);
    Some(BatteryStatus {
        level: Some(level.clamp(0.0, 1.0)),
        charging: Some(charging),
        supported: true,
    })
}

#[cfg(target_os = "android")]
fn read_battery() -> Option<BatteryStatus> {
    // The Android WebView is Chromium: `navigator.getBattery` covers it.
    None
}
