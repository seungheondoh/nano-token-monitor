mod commands;
mod oauth_usage;
mod providers;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// When true, the window will not auto-hide on focus loss (e.g. during dialog).
static DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

/// Timestamp (ms) when the window was last shown — prevents immediate focus-loss hide.
static LAST_SHOWN_MS: AtomicU64 = AtomicU64::new(0);

use notify::{Event, EventKind, RecursiveMode, Watcher};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

use providers::traits::TokenProvider;
use providers::types::{DefaultQuotaMonitoring, UserPreferences};

use std::collections::HashMap;

struct WindowAlertState {
    window_id: String,
    fired_thresholds: Vec<u32>,
    prev_utilization: f64,
}

struct AlertState {
    windows: HashMap<String, WindowAlertState>,
    last_notification_at: Option<Instant>,
}

static ALERT_STATE: Mutex<Option<AlertState>> = Mutex::new(None);

fn orange_tray_icon() -> tauri::image::Image<'static> {
    let size = 32u32;
    let radius = 12.0f32;
    let center = (size as f32 - 1.0) / 2.0;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let alpha = ((radius + 1.0 - distance).clamp(0.0, 1.0) * 255.0) as u8;
            rgba.extend_from_slice(&[245, 124, 0, alpha]);
        }
    }

    tauri::image::Image::new_owned(rgba, size, size)
}

/// Check OAuth usage thresholds and fire OS notifications for newly crossed thresholds.
fn check_and_fire_alerts(app_handle: &tauri::AppHandle) {
    let prefs = commands::get_preferences();
    if !prefs.usage_alerts_enabled {
        return;
    }

    let usage = match oauth_usage::get_cached_usage() {
        Some(u) => u,
        None => return,
    };

    let thresholds: Vec<u32> = vec![50, 80, 90];
    let monitored = DefaultQuotaMonitoring::default();

    // Build list of (name, utilization, window_id) for each monitored window.
    // window_id combines the window name with resets_at (truncated to hour) so that:
    //   - It changes when the usage window resets → clears fired_thresholds
    //   - It doesn't change on minor timestamp drift within the same window
    let mut windows_to_check: Vec<(&str, f64, String)> = Vec::new();

    // Truncate resets_at to hour to avoid spurious resets from second-level drift
    fn stable_window_id(name: &str, resets_at: &str) -> String {
        // Take first 13 chars of ISO timestamp (e.g. "2026-04-03T11") for hour-level stability
        let truncated = &resets_at[..resets_at.len().min(13)];
        format!("{}:{}", name, truncated)
    }

    if monitored.five_hour {
        if let Some(w) = &usage.five_hour {
            windows_to_check.push((
                "Session (5h)",
                w.utilization,
                stable_window_id("5h", &w.resets_at),
            ));
        }
    }
    if monitored.seven_day {
        if let Some(w) = &usage.seven_day {
            windows_to_check.push((
                "Weekly",
                w.utilization,
                stable_window_id("7d", &w.resets_at),
            ));
        }
    }
    if monitored.seven_day_sonnet {
        if let Some(w) = &usage.seven_day_sonnet {
            windows_to_check.push((
                "Weekly Sonnet",
                w.utilization,
                stable_window_id("7d-sonnet", &w.resets_at),
            ));
        }
    }
    if monitored.seven_day_opus {
        if let Some(w) = &usage.seven_day_opus {
            windows_to_check.push((
                "Weekly Opus",
                w.utilization,
                stable_window_id("7d-opus", &w.resets_at),
            ));
        }
    }
    if monitored.extra_usage {
        if let Some(w) = &usage.extra_usage {
            if w.is_enabled {
                // Extra usage resets monthly; use monthly_limit as part of ID
                windows_to_check.push((
                    "Extra Usage",
                    w.utilization,
                    format!("extra:{}", w.monthly_limit),
                ));
            }
        }
    }

    if windows_to_check.is_empty() {
        return;
    }

    let mut state_guard = match ALERT_STATE.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let state = state_guard.get_or_insert_with(|| AlertState {
        windows: HashMap::new(),
        last_notification_at: None,
    });

    // Cooldown: at least 60 seconds between notifications
    let cooldown_ok = state
        .last_notification_at
        .map(|last| last.elapsed().as_secs() >= 60)
        .unwrap_or(true);

    let mut os_notification: Option<(String, String)> = None;

    for (name, utilization, window_id) in &windows_to_check {
        let win_state = state
            .windows
            .entry(name.to_string())
            .or_insert_with(|| WindowAlertState {
                window_id: window_id.clone(),
                fired_thresholds: Vec::new(),
                prev_utilization: 0.0,
            });

        // Reset detection: if window changed or utilization dropped to ~0
        if win_state.window_id != *window_id {
            win_state.window_id = window_id.clone();
            win_state.fired_thresholds.clear();
        }

        win_state.prev_utilization = *utilization;

        // Find newly crossed thresholds
        let new_thresholds: Vec<u32> = thresholds
            .iter()
            .filter(|&&t| *utilization >= t as f64)
            .filter(|t| !win_state.fired_thresholds.contains(t))
            .copied()
            .collect();

        if new_thresholds.is_empty() {
            continue;
        }

        if !cooldown_ok {
            continue;
        }

        let highest = new_thresholds.iter().copied().max().unwrap_or(50);

        // Mark ALL crossed thresholds as fired to prevent re-sending lower ones
        // on subsequent polls while usage remains high. Only the highest is sent.
        for t in &new_thresholds {
            if !win_state.fired_thresholds.contains(t) {
                win_state.fired_thresholds.push(*t);
            }
        }

        // OS notification (only for five_hour to avoid spam, or if it's the highest alert)
        if *name == "Session (5h)" || os_notification.is_none() {
            let body = if highest >= 90 {
                format!(
                    "{} usage at {:.0}% — may be throttled soon",
                    name, utilization
                )
            } else {
                format!("{} usage at {:.0}%", name, utilization)
            };
            os_notification = Some(("Nano Token Monitor".to_string(), body));
        }
    }

    // Fire OS notification
    if let Some((title, body)) = os_notification {
        use tauri_plugin_notification::NotificationExt;
        let _ = app_handle
            .notification()
            .builder()
            .title(&title)
            .body(&body)
            .show();
        state.last_notification_at = Some(Instant::now());
    }
}

pub fn update_tray_title(app_handle: &tauri::AppHandle) {
    let prefs_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("nano-token-monitor-prefs.json");
    let prefs: UserPreferences = std::fs::read_to_string(&prefs_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let (title, tooltip) = if !prefs.show_tray_cost {
        (String::new(), "Nano Token Monitor".to_string())
    } else {
        let claude_pct = if prefs.include_claude {
            oauth_usage::get_cached_usage().and_then(|usage| {
                [
                    usage.five_hour.map(|w| w.utilization),
                    usage.seven_day.map(|w| w.utilization),
                    usage.seven_day_sonnet.map(|w| w.utilization),
                    usage.seven_day_opus.map(|w| w.utilization),
                    usage
                        .extra_usage
                        .filter(|w| w.is_enabled)
                        .map(|w| w.utilization),
                ]
                .into_iter()
                .flatten()
                .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            })
        } else {
            None
        };

        let codex_pct = if prefs.include_codex {
            providers::codex::get_cached_stats()
                .and_then(|s| s.rate_limits)
                .and_then(|limits| {
                    [
                        limits.primary.map(|w| w.used_percent),
                        limits.secondary.map(|w| w.used_percent),
                    ]
                    .into_iter()
                    .flatten()
                    .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                })
        } else {
            None
        };

        let fmt_pct = |value: Option<f64>| -> String {
            value
                .map(|v| format!("{:.0}%", v.clamp(0.0, 999.0)))
                .unwrap_or_else(|| "--".to_string())
        };

        let title = format!("Cl: {} | Co: {}", fmt_pct(claude_pct), fmt_pct(codex_pct));
        let tooltip = format!(
            "Nano Token Monitor - Claude: {}, Codex: {}",
            fmt_pct(claude_pct),
            fmt_pct(codex_pct),
        );
        (title, tooltip)
    };

    // Dispatch AppKit tray operations to main thread to avoid crash
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(tray) = handle.tray_by_id("main-tray") {
            #[cfg(target_os = "macos")]
            let _ = tray.set_title(Some(&title));
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    });
}

fn get_all_watch_dirs() -> Vec<PathBuf> {
    let prefs = commands::get_preferences();
    let home = dirs::home_dir().unwrap_or_default();
    let expand = |d: &str| -> PathBuf {
        if let Some(rest) = d.strip_prefix("~/") {
            home.join(rest)
        } else {
            PathBuf::from(d)
        }
    };
    let mut dirs: Vec<PathBuf> = prefs
        .config_dirs
        .iter()
        .map(|d| expand(d).join("projects"))
        .collect();

    // Add Codex session directories from preferences
    // Always include ~/.codex because CodexProvider::new() unconditionally prepends it
    let default_codex = home.join(".codex");
    let mut codex_seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for codex_dir in &prefs.codex_dirs {
        let expanded = expand(codex_dir);
        let canonical = expanded.canonicalize().unwrap_or_else(|_| expanded.clone());
        codex_seen.insert(canonical);
        dirs.push(expanded.join("sessions"));
        dirs.push(expanded.join("archived_sessions"));
    }
    let default_canonical = default_codex
        .canonicalize()
        .unwrap_or_else(|_| default_codex.clone());
    if !codex_seen.contains(&default_canonical) {
        dirs.push(default_codex.join("sessions"));
        dirs.push(default_codex.join("archived_sessions"));
    }

    dirs
}

fn start_file_watcher(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel();

        let mut watcher = match notify::recommended_watcher(move |res: Result<Event, _>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    let dominated = event.paths.iter().any(|p| {
                        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                        ext == "jsonl" || ext == "json" || ext == "db"
                    });
                    if dominated {
                        let _ = tx.send(());
                    }
                }
            }
        }) {
            Ok(w) => w,
            Err(_) => return,
        };

        let mut watched_dirs: Vec<PathBuf> = Vec::new();
        for dir in get_all_watch_dirs() {
            if dir.exists() {
                let _ = watcher.watch(&dir, RecursiveMode::Recursive);
                watched_dirs.push(dir);
            }
        }

        // Adaptive debounce: escalate during burst activity
        let mut recent_triggers: Vec<std::time::Instant> = Vec::new();
        let base_debounce = std::time::Duration::from_secs(2);
        let burst_debounce = std::time::Duration::from_secs(10);

        loop {
            match rx.recv_timeout(std::time::Duration::from_secs(60)) {
                Ok(()) => {
                    // Detect burst: count triggers in last 10 seconds
                    let now = std::time::Instant::now();
                    recent_triggers
                        .retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(10));
                    recent_triggers.push(now);

                    let debounce = if recent_triggers.len() >= 3 {
                        burst_debounce
                    } else {
                        base_debounce
                    };

                    // Debounce: drain events for the debounce duration
                    loop {
                        match rx.recv_timeout(debounce) {
                            Ok(()) => continue,
                            Err(mpsc::RecvTimeoutError::Timeout) => break,
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                    }
                    eprintln!(
                        "[WATCH] file changed (debounce={}s), invalidating cache",
                        debounce.as_secs()
                    );
                    providers::claude_code::invalidate_stats_cache();
                    providers::codex::invalidate_stats_cache();
                    let _ = app_handle.emit("stats-updated", ());
                    // Re-parse in background so the tray reflects new data even when the
                    // popup is closed (get_all_stats is only called by the frontend).
                    let app_for_refresh = app_handle.clone();
                    thread::spawn(move || {
                        let prefs = commands::get_preferences();
                        let provider = providers::claude_code::ClaudeCodeProvider::new(
                            prefs.config_dirs.clone(),
                        );
                        let _ = provider.fetch_stats();
                        if prefs.include_codex {
                            let _ = providers::codex::CodexProvider::new(prefs.codex_dirs.clone())
                                .fetch_stats();
                        }
                        update_tray_title(&app_for_refresh);
                    });
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Re-read watch dirs and update if changed
                    let new_watch: Vec<PathBuf> = get_all_watch_dirs()
                        .into_iter()
                        .filter(|p| p.exists())
                        .collect();
                    if new_watch != watched_dirs {
                        for dir in &watched_dirs {
                            let _ = watcher.unwatch(dir);
                        }
                        for dir in &new_watch {
                            let _ = watcher.watch(dir, RecursiveMode::Recursive);
                        }
                        watched_dirs = new_watch;
                        providers::claude_code::invalidate_stats_cache();
                        providers::codex::invalidate_stats_cache();
                        let _ = app_handle.emit("stats-updated", ());
                    }
                    update_tray_title(&app_handle);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

/// Bring the app to the foreground so WKWebView renders.
/// Required on macOS 26 Tahoe where the app runs as Accessory policy
/// and won't auto-activate — without this the window appears but content is white.
/// Skipped in fullscreen Spaces to avoid Space-switching.
#[cfg(target_os = "macos")]
fn activate_app() {
    #[allow(deprecated)]
    use cocoa::appkit::NSApplication;
    #[allow(deprecated)]
    use cocoa::base::nil;
    unsafe {
        #[allow(deprecated)]
        let ns_app = NSApplication::sharedApplication(nil);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps_(true);
    }
}

/// Check if the current Space is a fullscreen Space.
/// Uses NSApplication's currentSystemPresentationOptions.
#[cfg(target_os = "macos")]
fn is_fullscreen_space() -> bool {
    use objc::{msg_send, sel, sel_impl};
    unsafe {
        #[allow(deprecated)]
        let ns_app: cocoa::base::id = msg_send![objc::class!(NSApplication), sharedApplication];
        let options: u64 = msg_send![ns_app, currentSystemPresentationOptions];
        // NSApplicationPresentationFullScreen = 1 << 10
        (options & (1 << 10)) != 0
    }
}

/// Check if our app is still the frontmost (active) application.
/// System panels like the emoji picker steal window focus but keep the app active.
#[cfg(target_os = "macos")]
fn is_app_active() -> bool {
    #[allow(deprecated)]
    use cocoa::appkit::NSApplication;
    #[allow(deprecated)]
    use cocoa::base::nil;
    use objc::{msg_send, sel, sel_impl};
    unsafe {
        #[allow(deprecated)]
        let ns_app = NSApplication::sharedApplication(nil);
        let active: bool = msg_send![ns_app, isActive];
        active
    }
}

/// macOS window levels (from NSWindow.h)
#[cfg(target_os = "macos")]
const NS_FLOATING_WINDOW_LEVEL: i64 = 3;
#[cfg(target_os = "macos")]
const NS_STATUS_WINDOW_LEVEL: i64 = 25;

/// Temporarily lower window level so system panels (emoji picker) can appear above us.
#[cfg(target_os = "macos")]
fn lower_window_level(window: &tauri::WebviewWindow) {
    #[allow(deprecated)]
    use cocoa::appkit::NSWindow;
    if let Ok(ns_win) = window.ns_window() {
        unsafe {
            #[allow(deprecated)]
            let ns_win = ns_win as cocoa::base::id;
            #[allow(deprecated)]
            ns_win.setLevel_(NS_FLOATING_WINDOW_LEVEL);
        }
    }
}

/// Promote NSWindow to a custom NSPanel subclass for fullscreen overlay support.
/// Must be called once at startup. The NonActivatingPanel style mask bit (1 << 7)
/// tells the fullscreen compositor to render this panel above fullscreen apps.
/// The custom subclass overrides canBecomeKeyWindow → YES for WKWebView rendering.
#[cfg(target_os = "macos")]
fn promote_to_panel(window: &tauri::WebviewWindow) {
    use objc::runtime::{Class, Object, Sel, BOOL, YES};
    use objc::{msg_send, sel, sel_impl};
    use std::sync::Once;

    extern "C" {
        fn object_setClass(obj: *mut Object, cls: *const Class) -> *const Class;
    }

    extern "C" fn yes_method(_: &Object, _: Sel) -> BOOL {
        YES
    }

    const NS_NON_ACTIVATING_PANEL_MASK: u64 = 1 << 7;

    static PROMOTED: Once = Once::new();

    PROMOTED.call_once(|| {
        let panel_class = unsafe {
            let superclass = objc::class!(NSPanel);
            objc::declare::ClassDecl::new("TauriFullscreenPanel", superclass)
                .map(|mut cls| {
                    cls.add_method(
                        sel!(canBecomeKeyWindow),
                        yes_method as extern "C" fn(&Object, Sel) -> BOOL,
                    );
                    cls.add_method(
                        sel!(canBecomeMainWindow),
                        yes_method as extern "C" fn(&Object, Sel) -> BOOL,
                    );
                    cls.register()
                })
                .unwrap_or_else(|| objc::class!(TauriFullscreenPanel))
        };

        if let Ok(ns_win) = window.ns_window() {
            unsafe {
                #[allow(deprecated)]
                let ns_win = ns_win as cocoa::base::id;
                object_setClass(ns_win as *mut _, panel_class);
                let mask: u64 = msg_send![ns_win, styleMask];
                let _: () = msg_send![ns_win, setStyleMask: mask | NS_NON_ACTIVATING_PANEL_MASK];
                let _: () = msg_send![ns_win, setHidesOnDeactivate: false];
            }
        }
    });
}

/// Apply collection behavior + hidesOnDeactivate so the window can appear in
/// fullscreen Spaces and won't auto-hide when another app takes activation.
#[cfg(target_os = "macos")]
fn prepare_window_space_behavior(window: &tauri::WebviewWindow) {
    #[allow(deprecated)]
    use cocoa::appkit::NSWindow;
    #[allow(deprecated)]
    use cocoa::appkit::NSWindowCollectionBehavior;
    use objc::{msg_send, sel, sel_impl};

    if let Ok(ns_win) = window.ns_window() {
        unsafe {
            #[allow(deprecated)]
            let ns_win = ns_win as cocoa::base::id;
            #[allow(deprecated)]
            ns_win.setCollectionBehavior_(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
            );
            // Prevent auto-hide when another app activates (important in fullscreen)
            let _: () = msg_send![ns_win, setHidesOnDeactivate: false];
        }
    }
}

/// Restore window level only — used when focus is regained and the window is
/// already visible (no ordering needed).
#[cfg(target_os = "macos")]
fn restore_window_level(window: &tauri::WebviewWindow) {
    #[allow(deprecated)]
    use cocoa::appkit::NSWindow;

    if let Ok(ns_win) = window.ns_window() {
        unsafe {
            #[allow(deprecated)]
            let ns_win = ns_win as cocoa::base::id;
            #[allow(deprecated)]
            ns_win.setLevel_(NS_STATUS_WINDOW_LEVEL);
        }
    }
}

/// Show the window using raw AppKit calls for fullscreen compatibility.
/// Tauri's window.show() internally calls orderFront: which does nothing
/// when the app is inactive (Accessory policy). We use orderFrontRegardless
/// which works regardless of activation state.
#[cfg(target_os = "macos")]
fn show_window_native(window: &tauri::WebviewWindow) {
    #[allow(deprecated)]
    use cocoa::appkit::NSWindow;
    #[allow(deprecated)]
    use cocoa::base::nil;
    use objc::{msg_send, sel, sel_impl};

    if let Ok(ns_win) = window.ns_window() {
        unsafe {
            #[allow(deprecated)]
            let ns_win = ns_win as cocoa::base::id;
            #[allow(deprecated)]
            ns_win.setLevel_(NS_STATUS_WINDOW_LEVEL);
            // orderFrontRegardless works even when app is not active —
            // unlike orderFront:/makeKeyAndOrderFront: which are no-ops
            // for inactive apps
            let _: () = msg_send![ns_win, orderFrontRegardless];

            let in_fullscreen = is_fullscreen_space();
            if in_fullscreen {
                // In fullscreen: skip activateIgnoringOtherApps to avoid
                // Space-switching. The window is already visible via
                // orderFrontRegardless + CanJoinAllSpaces + FullScreenAuxiliary.
                // Try to accept keyboard input without full activation.
                let _: () = msg_send![ns_win, makeKeyWindow];
            } else {
                // Normal desktop: activate app (needed for WKWebView on Tahoe)
                // and bring to front with keyboard focus
                activate_app();
                #[allow(deprecated)]
                ns_win.makeKeyAndOrderFront_(nil);
            }
        }
    }
}

#[tauri::command]
fn get_home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn set_dialog_open(open: bool) {
    DIALOG_OPEN.store(open, Ordering::Relaxed);
    eprintln!("[CMD] set_dialog_open({})", open);
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    eprintln!("[CMD] hide_window called");
    let _ = window.hide();
}

#[tauri::command]
fn show_window(window: tauri::WebviewWindow) {
    eprintln!("[CMD] show_window called");
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    eprintln!("[CMD] quit_app called");
    app.exit(0);
}

/// Exit current process, then let a detached helper re-launch the app.
/// Direct spawn fails because the single-instance plugin holds a lock;
/// the new process sees the lock, sends a message to old, and quits —
/// then the old process exits too, leaving nothing running.
/// Fix: spawn a shell that sleeps past our exit, then opens the app.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    eprintln!("[CMD] restart_app called");
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    let app_bundle = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .ok_or("Could not determine .app bundle path")?;
    eprintln!("[CMD] scheduling relaunch of {:?}", app_bundle);
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("sleep 1 && open '{}'", app_bundle.display()))
        .spawn()
        .map_err(|e| e.to_string())?;

    // Exit immediately — the detached shell outlives us and restarts the app
    // after the single-instance lock is released.
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_all_stats,
            commands::get_codex_stats,
            commands::is_codex_available,
            commands::get_preferences,
            commands::set_preferences,
            commands::detect_claude_dirs,
            commands::validate_claude_dir,
            commands::detect_codex_dirs,
            commands::validate_codex_dir,
            get_home_dir,
            set_dialog_open,
            hide_window,
            quit_app,
            restart_app,
            commands::get_oauth_usage,
            commands::refresh_oauth_usage,
            commands::enable_usage_tracking
        ])
        .setup(|app| {
            // Build tray icon — direct click toggle
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(orange_tray_icon())
                .tooltip("Nano Token Monitor")
                .on_tray_icon_event(|tray, event| {
                    // Only handle mouse DOWN — Click fires for both Down and Up
                    if let tauri::tray::TrayIconEvent::Click {
                        button_state: tauri::tray::MouseButtonState::Down,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = app.emit("stats-updated", ());
                                let _ = position_window_near_tray(&window, tray);

                                let now_ms = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);
                                LAST_SHOWN_MS.store(now_ms, Ordering::SeqCst);

                                prepare_window_space_behavior(&window);
                                show_window_native(&window);
                            }
                        }
                    }
                })
                .build(app)?;

            // Hide from dock on macOS
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            let main_window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            promote_to_panel(&main_window);

            // Set collection behavior early so it persists across hide/show cycles
            #[cfg(target_os = "macos")]
            prepare_window_space_behavior(&main_window);

            let win_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::Focused(focused) => {
                        if !focused {
                            if DIALOG_OPEN.load(Ordering::Relaxed) {
                                return;
                            }
                            let win = win_clone.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(200));
                                if win.is_focused().unwrap_or(true) {
                                    return;
                                }
                                // Grace period: ignore focus-loss immediately after show
                                let now_ms = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);
                                if now_ms.saturating_sub(LAST_SHOWN_MS.load(Ordering::SeqCst)) < 400
                                {
                                    return;
                                }
                                // All AppKit calls must run on the main thread
                                #[cfg(target_os = "macos")]
                                {
                                    let w = win.clone();
                                    let _ = win.run_on_main_thread(move || {
                                        // In fullscreen Space: don't hide — the window was
                                        // shown without activation, so focus state is unreliable
                                        if is_fullscreen_space() {
                                            lower_window_level(&w);
                                            return;
                                        }
                                        // Don't hide if our app is still active (e.g. emoji picker)
                                        // Instead, lower window level so system panels appear above us
                                        if is_app_active() {
                                            lower_window_level(&w);
                                        } else {
                                            let _ = w.hide();
                                        }
                                    });
                                    return;
                                }
                                #[cfg(not(target_os = "macos"))]
                                let _ = win.hide();
                            });
                        } else {
                            // Focus regained — restore space behavior and level only
                            // (no orderFront needed, window already has focus)
                            #[cfg(target_os = "macos")]
                            {
                                let w = win_clone.clone();
                                let _ = win_clone.run_on_main_thread(move || {
                                    prepare_window_space_behavior(&w);
                                    restore_window_level(&w);
                                });
                            }
                        }
                    }
                    _ => {}
                }
            });

            // Initial tray cost update
            update_tray_title(&app.handle());

            // Start file watcher
            start_file_watcher(app.handle().clone());

            // Migrate existing users: auto-enable usage tracking if prefs file exists
            {
                let prefs_file = commands::prefs_path();
                if prefs_file.exists() {
                    let mut prefs = commands::get_preferences();
                    if !prefs.usage_tracking_migrated {
                        prefs.usage_tracking_enabled = true;
                        prefs.usage_tracking_migrated = true;
                        if let Ok(json) = serde_json::to_string_pretty(&prefs) {
                            let _ = std::fs::write(&prefs_file, json);
                        }
                    }
                }
            }

            // Start OAuth usage polling (5-minute interval, only when tracking enabled)
            {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    let rt = tauri::async_runtime::handle();
                    loop {
                        let poll_result =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                let prefs = commands::get_preferences();
                                if prefs.usage_tracking_enabled {
                                    // Skip if cache was recently populated (e.g. by enable_usage_tracking)
                                    if !oauth_usage::is_cache_fresh(30) {
                                        if let Some(_) =
                                            rt.block_on(oauth_usage::fetch_and_cache_usage())
                                        {
                                            update_tray_title(&handle);
                                            let _ = handle.emit("usage-updated", ());
                                            if prefs.usage_alerts_enabled {
                                                check_and_fire_alerts(&handle);
                                            }
                                        }
                                    }
                                    thread::sleep(std::time::Duration::from_secs(300));
                                } else {
                                    thread::sleep(std::time::Duration::from_secs(5));
                                }
                            }));

                        if let Err(panic_info) = poll_result {
                            let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                                s.to_string()
                            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                                s.clone()
                            } else {
                                "unknown panic".to_string()
                            };
                            eprintln!("[OAUTH-POLL] panic caught, will retry: {}", msg);
                            thread::sleep(std::time::Duration::from_secs(30));
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn position_window_near_tray(
    window: &tauri::WebviewWindow,
    tray: &tauri::tray::TrayIcon,
) -> Result<(), Box<dyn std::error::Error>> {
    let tray_rect = tray.rect()?.ok_or("Could not get tray rect")?;
    let scale = window.scale_factor()?;

    let tray_pos = tray_rect.position.to_logical::<f64>(scale);
    let tray_size = tray_rect.size.to_logical::<f64>(scale);

    let tray_center_x = tray_pos.x + (tray_size.width / 2.0);

    // Get the monitor where the tray is located
    if let Some(monitor) = window.available_monitors()?.into_iter().find(|m| {
        let pos = m.position().to_logical::<f64>(scale);
        let size = m.size().to_logical::<f64>(scale);
        tray_pos.x >= pos.x && tray_pos.x < pos.x + size.width
    }) {
        let monitor_pos = monitor.position().to_logical::<f64>(scale);
        let monitor_size = monitor.size().to_logical::<f64>(scale);
        let screen_mid_y = monitor_pos.y + (monitor_size.height / 2.0);

        // Detect if tray is at the bottom or top of the screen
        let tray_at_bottom = tray_pos.y > screen_mid_y;
        let padding = 12.0;

        if tray_at_bottom {
            let available_height = tray_pos.y - monitor_pos.y - padding;
            let desired_height = available_height.clamp(420.0, 560.0);

            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 440.0,
                height: desired_height,
            }));

            let window_size = window.outer_size()?.to_logical::<f64>(scale);
            let x = tray_center_x - (window_size.width / 2.0);
            let y = tray_pos.y - window_size.height - padding;

            window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))?;
        } else {
            // macOS-style: menu bar at top, show popup below tray
            let y = tray_pos.y + tray_size.height;
            let screen_bottom = monitor_pos.y + monitor_size.height;
            let max_height = screen_bottom - y - padding;
            let desired_height = max_height.clamp(420.0, 560.0);

            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: 440.0,
                height: desired_height,
            }));

            let window_size = window.outer_size()?.to_logical::<f64>(scale);
            let x = tray_center_x - (window_size.width / 2.0);

            window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))?;
        }
    } else {
        // Fallback: no monitor found, just position below tray
        let y = tray_pos.y + tray_size.height;
        let window_size = window.outer_size()?.to_logical::<f64>(scale);
        let x = tray_center_x - (window_size.width / 2.0);

        window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))?;
    }

    Ok(())
}
