use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    pub date: String,
    pub tokens: HashMap<String, u64>,
    pub cost_usd: f64,
    pub messages: u32,
    pub sessions: u32,
    pub tool_calls: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectUsage {
    pub name: String,
    pub cost_usd: f64,
    pub tokens: u64,
    pub sessions: u32,
    pub messages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCount {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerUsage {
    pub server: String,
    pub calls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityCategory {
    pub category: String,
    pub cost_usd: f64,
    pub messages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsData {
    pub project_usage: Vec<ProjectUsage>,
    pub tool_usage: Vec<ToolCount>,
    pub shell_commands: Vec<ToolCount>,
    pub mcp_usage: Vec<McpServerUsage>,
    pub activity_breakdown: Vec<ActivityCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitWindow {
    pub used_percent: f64,
    pub window_minutes: u32,
    pub resets_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexRateLimits {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<RateLimitWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<RateLimitWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_reached_type: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllStats {
    pub daily: Vec<DailyUsage>,
    pub model_usage: HashMap<String, ModelUsage>,
    pub total_sessions: u32,
    pub total_messages: u32,
    pub first_session_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analytics: Option<AnalyticsData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limits: Option<CodexRateLimits>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    pub number_format: String,
    pub show_tray_cost: bool,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_color_mode")]
    pub color_mode: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_config_dirs")]
    pub config_dirs: Vec<String>,
    #[serde(default = "default_true")]
    pub include_claude: bool,
    #[serde(default)]
    pub include_codex: bool,
    #[serde(default = "default_codex_dirs")]
    pub codex_dirs: Vec<String>,
    #[serde(default = "default_true")]
    pub usage_alerts_enabled: bool,
    #[serde(default)]
    pub usage_tracking_enabled: bool,
    #[serde(default)]
    pub usage_tracking_migrated: bool,
    #[serde(default)]
    pub autostart_enabled: bool,
    #[serde(default)]
    pub quick_action_items: Vec<String>,
    #[serde(default)]
    pub manual_oauth_token: Option<String>,
}

fn default_theme() -> String {
    "github".to_string()
}

fn default_color_mode() -> String {
    "system".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

fn default_config_dirs() -> Vec<String> {
    vec!["~/.claude".to_string()]
}

fn default_codex_dirs() -> Vec<String> {
    vec!["~/.codex".to_string()]
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultQuotaMonitoring {
    #[serde(default = "default_true")]
    pub five_hour: bool,
    #[serde(default = "default_true")]
    pub seven_day: bool,
    #[serde(default)]
    pub seven_day_sonnet: bool,
    #[serde(default)]
    pub seven_day_opus: bool,
    #[serde(default)]
    pub extra_usage: bool,
}

impl Default for DefaultQuotaMonitoring {
    fn default() -> Self {
        Self {
            five_hour: true,
            seven_day: true,
            seven_day_sonnet: false,
            seven_day_opus: false,
            extra_usage: false,
        }
    }
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            number_format: "compact".to_string(),
            show_tray_cost: true,
            device_id: None,
            theme: default_theme(),
            color_mode: default_color_mode(),
            language: default_language(),
            config_dirs: default_config_dirs(),
            include_claude: true,
            include_codex: false,
            codex_dirs: default_codex_dirs(),
            usage_alerts_enabled: true,
            usage_tracking_enabled: false,
            usage_tracking_migrated: false,
            autostart_enabled: false,
            quick_action_items: vec![],
            manual_oauth_token: None,
        }
    }
}
