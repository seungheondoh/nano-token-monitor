use std::fs;
use std::path::PathBuf;

use crate::providers::claude_code::ClaudeCodeProvider;
use crate::providers::codex::CodexProvider;
use crate::providers::traits::TokenProvider;
use crate::providers::types::{AllStats, UserPreferences};

use tauri::Emitter;

pub(crate) fn prefs_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("nano-token-monitor-prefs.json")
}

#[tauri::command]
pub async fn get_all_stats(app: tauri::AppHandle) -> Result<AllStats, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        let prefs = get_preferences();
        let provider = ClaudeCodeProvider::new(prefs.config_dirs);
        if !provider.is_available() {
            return Err("Claude Code stats not available".to_string());
        }
        provider.fetch_stats()
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.is_ok() {
        crate::update_tray_title(&app);
    }
    result
}

#[tauri::command]
pub async fn get_codex_stats(app: tauri::AppHandle) -> Result<AllStats, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        let prefs = get_preferences();
        let provider = CodexProvider::new(prefs.codex_dirs);
        if !provider.is_available() {
            return Err("Codex stats not available".to_string());
        }
        provider.fetch_stats()
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.is_ok() {
        crate::update_tray_title(&app);
    }
    result
}

#[tauri::command]
pub fn is_codex_available() -> bool {
    let prefs = get_preferences();
    CodexProvider::new(prefs.codex_dirs).is_available()
}

#[tauri::command]
pub fn detect_claude_dirs() -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut found: Vec<String> = Vec::new();

    // Scan ~/.claude-* directories
    if let Ok(entries) = std::fs::read_dir(&home) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(".claude-") && entry.path().join("projects").is_dir() {
                found.push(format!("~/{}", name));
            }
        }
    }

    // Check CLAUDE_CONFIG_DIR env var
    if let Ok(env_dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let path = PathBuf::from(&env_dir);
        if path.join("projects").is_dir() {
            let display = if let Ok(stripped) = path.strip_prefix(&home) {
                format!("~/{}", stripped.display())
            } else {
                env_dir
            };
            if !found.contains(&display) && display != "~/.claude" {
                found.push(display);
            }
        }
    }

    found.sort();
    found
}

#[tauri::command]
pub fn detect_codex_dirs() -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut found: Vec<String> = Vec::new();

    // Scan ~/.codex-* directories
    if let Ok(entries) = std::fs::read_dir(&home) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(".codex-")
                && (entry.path().join("sessions").is_dir()
                    || entry.path().join("archived_sessions").is_dir())
            {
                found.push(format!("~/{}", name));
            }
        }
    }

    // Check CODEX_CONFIG_DIR env var
    if let Ok(env_dir) = std::env::var("CODEX_CONFIG_DIR") {
        let path = PathBuf::from(&env_dir);
        if path.join("sessions").is_dir() || path.join("archived_sessions").is_dir() {
            let display = if let Ok(stripped) = path.strip_prefix(&home) {
                format!("~/{}", stripped.display())
            } else {
                env_dir
            };
            if !found.contains(&display) && display != "~/.codex" {
                found.push(display);
            }
        }
    }

    found.sort();
    found
}

#[tauri::command]
pub fn validate_codex_dir(path: String) -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    let expanded = if path.starts_with("~/") {
        home.join(path.strip_prefix("~/").unwrap_or(&path))
    } else {
        PathBuf::from(&path)
    };
    // Guard against path traversal outside home directory
    let canonical = match expanded.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    if !canonical.starts_with(&home) {
        return false;
    }
    canonical.join("sessions").is_dir() || canonical.join("archived_sessions").is_dir()
}

#[tauri::command]
pub fn validate_claude_dir(path: String) -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    let expanded = if path.starts_with("~/") {
        home.join(path.strip_prefix("~/").unwrap_or(&path))
    } else {
        PathBuf::from(&path)
    };
    // Guard against path traversal outside home directory
    let canonical = match expanded.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    if !canonical.starts_with(&home) {
        return false;
    }
    canonical.join("projects").is_dir()
}

#[tauri::command]
pub fn get_preferences() -> UserPreferences {
    let path = prefs_path();
    let mut prefs: UserPreferences = if let Ok(content) = fs::read_to_string(&path) {
        match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[PREFS] Failed to parse prefs: {e}. Backing up and using defaults.");
                let backup = path.with_extension("json.bak");
                let _ = fs::copy(&path, &backup);
                UserPreferences::default()
            }
        }
    } else {
        UserPreferences::default()
    };

    prefs
}

#[tauri::command]
pub fn set_preferences(app: tauri::AppHandle, prefs: UserPreferences) -> Result<(), String> {
    let path = prefs_path();
    let json = serde_json::to_string_pretty(&prefs)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write preferences: {}", e))?;
    crate::update_tray_title(&app);
    Ok(())
}

#[tauri::command]
pub fn get_oauth_usage() -> Option<crate::oauth_usage::OAuthUsage> {
    crate::oauth_usage::get_cached_usage()
}

#[tauri::command]
pub async fn refresh_oauth_usage(app: tauri::AppHandle) -> Option<crate::oauth_usage::OAuthUsage> {
    // Throttle: if cache is fresh within 30 seconds, return it without hitting the API.
    // Mirrors the frontend cooldown so rapid manual clicks cannot hammer the OAuth endpoint
    // even if the UI gate is bypassed.
    if crate::oauth_usage::is_cache_fresh(30) {
        return crate::oauth_usage::get_cached_usage();
    }
    let result = crate::oauth_usage::fetch_and_cache_usage().await;
    if result.is_some() {
        let _ = app.emit("usage-updated", ());
    }
    result
}

#[tauri::command]
pub async fn enable_usage_tracking(app: tauri::AppHandle) -> Result<(), String> {
    let mut prefs = get_preferences();
    prefs.usage_tracking_enabled = true;
    set_preferences(app.clone(), prefs)?;

    // Immediately fetch so user sees data right away
    if let Some(_) = crate::oauth_usage::fetch_and_cache_usage().await {
        let _ = app.emit("usage-updated", ());
    }
    Ok(())
}
