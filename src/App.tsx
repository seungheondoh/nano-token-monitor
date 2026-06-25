import { useEffect } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCombinedStats } from "./hooks/useCombinedStats";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { PopoverShell } from "./components/PopoverShell";
import { Header } from "./components/Header";
import { SourceSelector } from "./components/SourceSelector";
import { UsageAlertBar } from "./components/UsageAlertBar";
import { ProjectBreakdown } from "./components/ProjectBreakdown";
import { useUpdater } from "./hooks/useUpdater";

function AnalyticsEmptyState({ message }: { message: string }) {
  return (
    <div style={{
      background: "var(--bg-card)",
      borderRadius: "var(--radius-lg)",
      padding: "22px 16px",
      boxShadow: "var(--shadow-card)",
      textAlign: "center",
      color: "var(--text-secondary)",
      fontSize: 12,
    }}>
      {message}
    </div>
  );
}

function AppContent() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only hide the window if no overlay/modal has already handled this Escape press
      if (e.key === "Escape" && !e.defaultPrevented) {
        invoke("hide_window").catch(() => {});
      }
    };
    // Use capture=false so modal keydown handlers (which run first) can call
    // e.preventDefault() to stop this from also closing the window.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { prefs } = useSettings();
  const { stats, error, loading } = useCombinedStats({
    includeClaude: prefs.include_claude,
    includeCodex: prefs.include_codex,
  });
  const t = useI18n();
  const updater = useUpdater();

  if (loading && !stats) {
    return (
      <PopoverShell>
        <Header updater={updater} />
        <SourceSelector />
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          color: "var(--text-secondary)",
          fontSize: 13,
          fontWeight: 600,
        }}>
          {t("app.loading")}
        </div>
      </PopoverShell>
    );
  }

  if (error || !stats) {
    return (
      <PopoverShell>
        <Header updater={updater} />
        <SourceSelector />
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 8,
          color: "var(--text-secondary)",
          fontSize: 12,
          fontWeight: 600,
          textAlign: "center",
          padding: 20,
        }}>
          <div style={{ fontSize: 24 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div>{t("app.error.title")}</div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
            {t("app.error.description")}
          </div>
        </div>
      </PopoverShell>
    );
  }

  return (
    <PopoverShell>
      <Header stats={stats} updater={updater} />
      <SourceSelector />

      <UsageAlertBar />
      {stats.analytics && stats.analytics.project_usage.length > 0
        ? <ProjectBreakdown data={stats.analytics.project_usage} />
        : <AnalyticsEmptyState message={t("analytics.empty.projects")} />
      }
    </PopoverShell>
  );
}

function I18nBridge({ children }: { children: ReactNode }) {
  const { prefs } = useSettings();
  return (
    <I18nProvider locale={prefs.language}>
      {children}
    </I18nProvider>
  );
}

function App() {
  return (
    <SettingsProvider>
      <I18nBridge>
        <AppContent />
      </I18nBridge>
    </SettingsProvider>
  );
}

export default App;
