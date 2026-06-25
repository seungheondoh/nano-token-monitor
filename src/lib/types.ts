export interface DailyUsage {
  date: string;
  tokens: Record<string, number>;
  cost_usd: number;
  messages: number;
  sessions: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
}

export interface ProjectUsage {
  name: string;
  source?: "claude" | "codex";
  cost_usd: number;
  tokens: number;
  sessions: number;
  messages: number;
}

export interface ToolCount {
  name: string;
  count: number;
}

export interface McpServerUsage {
  server: string;
  calls: number;
}

export interface ActivityCategory {
  category: string;
  cost_usd: number;
  messages: number;
}

export interface AnalyticsData {
  project_usage: ProjectUsage[];
  tool_usage: ToolCount[];
  shell_commands: ToolCount[];
  mcp_usage: McpServerUsage[];
  activity_breakdown: ActivityCategory[];
}

export interface RateLimitWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number;
}

export interface CodexRateLimits {
  limit_id?: string | null;
  limit_name?: string | null;
  plan_type?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  rate_limit_reached_type?: string | null;
  source: "oauth" | "jsonl" | string;
}

export interface AllStats {
  daily: DailyUsage[];
  model_usage: Record<string, ModelUsage>;
  total_sessions: number;
  total_messages: number;
  first_session_date: string | null;
  analytics?: AnalyticsData;
  rate_limits?: CodexRateLimits | null;
}

export interface UserPreferences {
  number_format: "compact" | "full";
  show_tray_cost: boolean;
  device_id?: string;
  include_claude: boolean;
  include_codex: boolean;
  theme: "github" | "purple" | "ocean" | "sunset";
  color_mode: "system" | "light" | "dark";
  language: "en" | "ko" | "ja" | "zh-CN" | "zh-TW" | "fr" | "es" | "de" | "tr" | "it";
  config_dirs: string[];
  codex_dirs: string[];
  usage_alerts_enabled: boolean;
  usage_tracking_enabled: boolean;
  autostart_enabled: boolean;
  quick_action_items: string[];
  manual_oauth_token?: string | null;
}

export interface UsageWindow {
  utilization: number;
  resets_at: string;
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number;
}

export interface OAuthUsage {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  seven_day_opus: UsageWindow | null;
  extra_usage: ExtraUsage | null;
  fetched_at: string;
  is_stale: boolean;
}
