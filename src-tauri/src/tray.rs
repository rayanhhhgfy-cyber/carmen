//! System tray — desktop only.
//!
//! Behaviour (see requirement: close-to-tray with background audio):
//! * left click on the tray icon  → show / focus the main window;
//! * right click                  → menu (Open, Play/Pause, Next, Quit);
//! * "Quit" is the only path that actually terminates the process.
//!
//! The frontend keeps the dynamic Play/Pause label in sync by emitting
//! `tray://state` (`{ playing: boolean }`), and receives menu hits back as
//! `tray://action` (`{ action: 'toggle' | 'next' }`).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager, Wry};

const MENU_SHOW: &str = "show";
const MENU_TOGGLE: &str = "toggle";
const MENU_NEXT: &str = "next";
const MENU_QUIT: &str = "quit";

const STATE_EVENT: &str = "tray://state";
const ACTION_EVENT: &str = "tray://action";

/// Payload the frontend sends so the tray can label itself correctly.
#[derive(serde::Deserialize)]
struct PlayerState {
    playing: bool,
}

/// Payload sent back to the frontend when a tray menu item is hit.
#[derive(serde::Serialize, Clone)]
struct ActionEvent {
    action: &'static str,
}

/// Builds the tray icon + menu and wires the event bridge.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundle must ship an icon for the tray");

    let show = MenuItem::with_id(app, MENU_SHOW, "Open Carmen", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, MENU_TOGGLE, "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, MENU_NEXT, "Next track", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Carmen", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &toggle, &next, &quit])?;

    // Keep a handle on the dynamic item so `tray://state` can relabel it.
    app.manage(TrayMenu {
        toggle: toggle.clone(),
    });

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Carmen")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Frontend → tray: keep the Play/Pause label honest.
    let handle = app.clone();
    app.listen(STATE_EVENT, move |event| {
        let payload = event.payload();
        let Ok(state) = serde_json::from_str::<PlayerState>(payload) else {
            return;
        };
        let label = if state.playing { "Pause" } else { "Play" };
        if let Some(menu) = handle.try_state::<TrayMenu>() {
            let _ = menu.toggle.set_text(label);
        }
    });

    Ok(())
}

struct TrayMenu {
    toggle: MenuItem<Wry>,
}

fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        MENU_SHOW => show_window(app),
        MENU_TOGGLE => emit_action(app, "toggle"),
        MENU_NEXT => emit_action(app, "next"),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn emit_action(app: &AppHandle, action: &'static str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(ACTION_EVENT, ActionEvent { action });
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
