import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useOAuthUsage } from "../hooks/useOAuthUsage";
import { useTokenStats } from "../hooks/useTokenStats";
import { useSettings } from "../contexts/SettingsContext";
import { useI18n } from "../i18n/I18nContext";
import type { RateLimitWindow } from "../lib/types";

const REFRESH_COOLDOWN_SECONDS = 30;
const CLAUDE_COLOR = "#f97316";
const CODEX_COLOR = "#0284c7";

interface QuotaWindow {
  label: string;
  utilization: number;
  reset: string;
}

function formatResetTime(resetsAt: string, t: (key: string, params?: Record<string, string>) => string): string {
  const reset = new Date(resetsAt);
  const now = new Date();
  const diffMs = reset.getTime() - now.getTime();
  if (diffMs <= 0) return t("usageAlert.resetsNow");
  const totalMin = Math.floor(diffMs / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return t("usageAlert.resetsIn", { time: parts.join(" ") });
}

function formatUnixResetTime(resetsAt: number, t: (key: string, params?: Record<string, string>) => string): string {
  return formatResetTime(new Date(resetsAt * 1000).toISOString(), t);
}

function formatCodexWindowLabel(
  window: RateLimitWindow,
  fallback: string,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (window.window_minutes === 300) return t("usageAlert.sessionShort");
  if (window.window_minutes === 10_080) return t("usageAlert.weekly");
  if (window.window_minutes >= 1_440 && window.window_minutes % 1_440 === 0) {
    return `${window.window_minutes / 1_440}d`;
  }
  if (window.window_minutes >= 60 && window.window_minutes % 60 === 0) {
    return `${window.window_minutes / 60}h`;
  }
  return fallback;
}

function peakWindow(windows: QuotaWindow[]): QuotaWindow | null {
  return windows.reduce<QuotaWindow | null>((peak, win) => {
    if (!peak || win.utilization > peak.utilization) return win;
    return peak;
  }, null);
}

function MiniBar({ percent, color }: { percent: number; color: string }) {
  const value = Math.max(0, Math.min(percent, 100));
  return (
    <div style={{
      height: 7,
      borderRadius: 4,
      background: "var(--heat-0)",
      overflow: "hidden",
    }}>
      <div style={{
        width: `${value}%`,
        height: "100%",
        borderRadius: 4,
        background: color,
      }} />
    </div>
  );
}

function RefreshButton({
  refreshing,
  cooldown,
  onClick,
}: {
  refreshing: boolean;
  cooldown: number;
  onClick: () => void;
}) {
  const t = useI18n();
  const disabled = refreshing || cooldown > 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        refreshing
          ? t("usageAlert.refreshing")
          : cooldown > 0
          ? `${t("usageAlert.refresh")} (${cooldown}s)`
          : t("usageAlert.refresh")
      }
      aria-label={t("usageAlert.refresh")}
      style={{
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "1px solid var(--heat-1)",
        borderRadius: 5,
        background: "var(--heat-0)",
        color: "var(--text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: refreshing ? "miniProfileSpin 0.8s linear infinite" : "none" }}
      >
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
  );
}

function QuotaCard({
  title,
  windows,
  stale,
  action,
  empty,
  color,
}: {
  title: string;
  windows: QuotaWindow[];
  stale?: boolean;
  action?: ReactNode;
  empty: ReactNode;
  color: string;
}) {
  const t = useI18n();
  const peak = peakWindow(windows);

  return (
    <div style={{
      minWidth: 0,
      padding: 10,
      borderRadius: "var(--radius-md)",
      background: "var(--heat-0)",
      border: "1px solid rgba(128,128,128,0.12)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 8,
      }}>
        <div style={{
          minWidth: 0,
          fontSize: 12,
          fontWeight: 800,
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {stale && (
            <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>
              {t("usageAlert.stale")}
            </span>
          )}
          {action}
        </div>
      </div>

      {peak ? (
        <>
          <div style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 8,
          }}>
            <div style={{
              minWidth: 0,
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {peak.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 850, color, lineHeight: 1 }}>
              {peak.utilization.toFixed(0)}%
            </div>
          </div>
          <MiniBar percent={peak.utilization} color={color} />
          <div style={{
            marginTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}>
            {windows.map((win) => (
              <div key={`${win.label}-${win.reset}`} style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                fontSize: 10,
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 6,
                  minWidth: 0,
                }}>
                  <span style={{
                    minWidth: 0,
                    color: "var(--text-secondary)",
                    fontWeight: 650,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {win.label}
                  </span>
                  <span style={{ color, fontWeight: 800, flexShrink: 0 }}>
                    {win.utilization.toFixed(0)}%
                  </span>
                </div>
                <div style={{
                  minWidth: 0,
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {win.reset}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{
          minHeight: 78,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 8,
          color: "var(--text-secondary)",
          fontSize: 10,
          lineHeight: 1.45,
        }}>
          {empty}
        </div>
      )}
    </div>
  );
}

function ClaudeEnableButton({
  enabling,
  onEnable,
}: {
  enabling: boolean;
  onEnable: () => Promise<void>;
}) {
  const t = useI18n();
  return (
    <button
      onClick={onEnable}
      disabled={enabling}
      style={{
        width: "100%",
        padding: "6px 8px",
        border: "1px solid var(--heat-1)",
        borderRadius: 6,
        background: "var(--bg-card)",
        color: "var(--text-primary)",
        fontSize: 10,
        fontWeight: 750,
        cursor: enabling ? "default" : "pointer",
        opacity: enabling ? 0.6 : 1,
      }}
    >
      {enabling ? t("usageTracking.enabling") : t("usageTracking.enable")}
    </button>
  );
}

export function UsageAlertBar() {
  const { prefs, refreshPrefs } = useSettings();
  const { usage, refreshing, refresh } = useOAuthUsage();
  const { stats: codexStats, refetch: refetchCodexStats } = useTokenStats("codex");
  const t = useI18n();
  const [enabling, setEnabling] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codexRefreshing, setCodexRefreshing] = useState(false);
  const [codexCooldown, setCodexCooldown] = useState(0);
  const cooldownTimerRef = useRef<number | null>(null);
  const codexCooldownTimerRef = useRef<number | null>(null);
  const showClaude = prefs.include_claude;
  const showCodex = prefs.include_codex;

  const enableClaudeTracking = async () => {
    setEnabling(true);
    try {
      await invoke("enable_usage_tracking");
      await refreshPrefs();
    } finally {
      setEnabling(false);
    }
  };

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current !== null) {
        window.clearInterval(cooldownTimerRef.current);
      }
      if (codexCooldownTimerRef.current !== null) {
        window.clearInterval(codexCooldownTimerRef.current);
      }
    };
  }, []);

  const handleRefresh = async () => {
    if (refreshing || cooldown > 0) return;
    setCooldown(REFRESH_COOLDOWN_SECONDS);
    if (cooldownTimerRef.current !== null) {
      window.clearInterval(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current !== null) {
            window.clearInterval(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    await refresh();
  };

  const handleCodexRefresh = async () => {
    if (codexRefreshing || codexCooldown > 0) return;
    setCodexRefreshing(true);
    setCodexCooldown(REFRESH_COOLDOWN_SECONDS);
    if (codexCooldownTimerRef.current !== null) {
      window.clearInterval(codexCooldownTimerRef.current);
    }
    codexCooldownTimerRef.current = window.setInterval(() => {
      setCodexCooldown((prev) => {
        if (prev <= 1) {
          if (codexCooldownTimerRef.current !== null) {
            window.clearInterval(codexCooldownTimerRef.current);
            codexCooldownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      await refetchCodexStats();
    } finally {
      setCodexRefreshing(false);
    }
  };

  const claudeQuotaItems = useMemo<QuotaWindow[]>(() => {
    if (!showClaude || !usage) return [];
    const windows: QuotaWindow[] = [];
    if (usage.five_hour) {
      windows.push({
        label: t("usageAlert.sessionShort"),
        utilization: usage.five_hour.utilization,
        reset: formatResetTime(usage.five_hour.resets_at, t),
      });
    }
    if (usage.seven_day) {
      windows.push({
        label: t("usageAlert.weekly"),
        utilization: usage.seven_day.utilization,
        reset: formatResetTime(usage.seven_day.resets_at, t),
      });
    }
    if (usage.seven_day_sonnet) {
      windows.push({
        label: t("usageAlert.sonnet"),
        utilization: usage.seven_day_sonnet.utilization,
        reset: formatResetTime(usage.seven_day_sonnet.resets_at, t),
      });
    }
    if (usage.seven_day_opus) {
      windows.push({
        label: t("usageAlert.opus"),
        utilization: usage.seven_day_opus.utilization,
        reset: formatResetTime(usage.seven_day_opus.resets_at, t),
      });
    }
    if (usage.extra_usage?.is_enabled) {
      windows.push({
        label: t("usageAlert.extraUsage"),
        utilization: usage.extra_usage.utilization,
        reset: `$${usage.extra_usage.used_credits.toFixed(2)} / $${usage.extra_usage.monthly_limit.toFixed(2)}`,
      });
    }
    return windows;
  }, [showClaude, usage, t]);

  const codexRateLimits = codexStats?.rate_limits ?? null;
  const codexQuotaItems = useMemo<QuotaWindow[]>(() => {
    if (!showCodex || !codexRateLimits) return [];
    return [codexRateLimits.primary, codexRateLimits.secondary]
      .filter((window): window is RateLimitWindow => !!window)
      .map((window) => ({
        label: formatCodexWindowLabel(window, t("usageAlert.limit"), t),
        utilization: window.used_percent,
        reset: formatUnixResetTime(window.resets_at, t),
      }));
  }, [showCodex, codexRateLimits, t]);

  if (!showClaude && !showCodex) return null;

  return (
    <div style={{
      background: "var(--bg-card)",
      borderRadius: "var(--radius-lg)",
      padding: 12,
      boxShadow: "var(--shadow-card)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 10,
      }}>
        <div style={{
          minWidth: 0,
          fontSize: 12,
          fontWeight: 800,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {t("usageAlert.title")}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: showClaude && showCodex ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
        gap: 10,
      }}>
        {showClaude && (
          <QuotaCard
            title={t("usageAlert.claude")}
            windows={claudeQuotaItems}
            stale={usage?.is_stale}
            color={CLAUDE_COLOR}
            action={(
              <RefreshButton
                refreshing={refreshing}
                cooldown={cooldown}
                onClick={handleRefresh}
              />
            )}
            empty={prefs.usage_tracking_enabled ? (
              <span>{t("usageAlert.noQuotaData")}</span>
            ) : (
              <>
                <span>{t("usageTracking.description")}</span>
                <ClaudeEnableButton enabling={enabling} onEnable={enableClaudeTracking} />
              </>
            )}
          />
        )}
        {showCodex && (
          <QuotaCard
            title={t("usageAlert.codex")}
            windows={codexQuotaItems}
            color={CODEX_COLOR}
            action={(
              <RefreshButton
                refreshing={codexRefreshing}
                cooldown={codexCooldown}
                onClick={handleCodexRefresh}
              />
            )}
            empty={<span>{t("usageAlert.noQuotaData")}</span>}
          />
        )}
      </div>
    </div>
  );
}
