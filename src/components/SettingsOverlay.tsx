import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { useSettings } from "../contexts/SettingsContext";
import { useI18n, LANGUAGE_OPTIONS, type Locale } from "../i18n/I18nContext";
import { InfoTooltip } from "./InfoTooltip";

interface Props {
  visible: boolean;
  onClose: () => void;
  initialTab?: string;
  centered?: boolean;
}

export function SettingsOverlay({ visible, onClose, centered }: Props) {
  const { prefs, updatePrefs } = useSettings();
  const [appVersion, setAppVersion] = useState("");
  const t = useI18n();

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEsc, true);
    return () => document.removeEventListener("keydown", handleEsc, true);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: centered ? 998 : 50,
          background: centered ? "rgba(0, 0, 0, 0.4)" : "transparent",
          ...(centered ? { display: "flex", alignItems: "center", justifyContent: "center" } : {}),
        }}
      />
      <div style={{
        position: centered ? "fixed" : "absolute",
        ...(centered
          ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 999 }
          : { top: 48, right: 16, zIndex: 51 }),
        background: "var(--bg-card)",
        borderRadius: "var(--radius-md)",
        boxShadow: centered ? "0 12px 40px rgba(0,0,0,0.3)" : "0 8px 24px rgba(0,0,0,0.15)",
        padding: 12,
        width: 280,
        maxHeight: centered ? "80vh" : "calc(100vh - 80px)",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(124, 92, 252, 0.1)",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            {t("settings.title")}
          </div>
          {centered && (
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
                color: "var(--text-muted)",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              x
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <GeneralTab prefs={prefs} updatePrefs={updatePrefs} />
        </div>

        <div style={{ height: 1, background: "var(--heat-0)", margin: "8px 0" }} />
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: centered ? "flex-end" : "space-between",
        }}>
          {!centered && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>
              v{appVersion}
            </span>
          )}
          {centered ? (
            <button
              onClick={onClose}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: "rgba(124, 92, 252, 0.1)",
                color: "var(--accent-purple)",
              }}
            >
              {t("settings.close")}
            </button>
          ) : (
            <button
              onClick={() => invoke("quit_app")}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
              }}
            >
              {t("settings.quit")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function GeneralTab({
  prefs,
  updatePrefs,
}: {
  prefs: ReturnType<typeof useSettings>["prefs"];
  updatePrefs: ReturnType<typeof useSettings>["updatePrefs"];
}) {
  const t = useI18n();

  const setAutostart = useCallback(async (enabled: boolean) => {
    updatePrefs({ autostart_enabled: enabled });
    try {
      if (enabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
    } catch (err) {
      console.warn("[autostart] update failed", err);
    }
  }, [updatePrefs]);

  return (
    <div>
      <SettingRow label={t("settings.appearance")}>
        <ColorModeToggle value={prefs.color_mode} onChange={(v) => updatePrefs({ color_mode: v })} />
      </SettingRow>

      <SettingRow label={t("settings.language")}>
        <LanguageSelector value={prefs.language} onChange={(v) => updatePrefs({ language: v })} />
      </SettingRow>

      <SettingRow
        label={t("settings.numberFormat")}
        description={prefs.number_format === "compact" ? "377.0K" : "377,000"}
      >
        <ToggleButton
          options={["compact", "full"]}
          value={prefs.number_format}
          onChange={(v) => updatePrefs({ number_format: v as "compact" | "full" })}
        />
      </SettingRow>

      <SettingRow label={t("settings.menuBarCost")}>
        <ToggleSwitch
          checked={prefs.show_tray_cost}
          onChange={(v) => updatePrefs({ show_tray_cost: v })}
        />
      </SettingRow>

      <SettingRow label={t("settings.autostart")}>
        <ToggleSwitch checked={prefs.autostart_enabled} onChange={setAutostart} />
      </SettingRow>

      <SettingRow label={t("settings.usageTracking")}>
        <ToggleSwitch
          checked={prefs.usage_tracking_enabled}
          onChange={(v) => updatePrefs({ usage_tracking_enabled: v })}
        />
      </SettingRow>

      <OAuthTokenSection prefs={prefs} updatePrefs={updatePrefs} />

      <Divider />
      <ConfigDirsSection
        provider="claude"
        dirs={prefs.config_dirs}
        onChange={(dirs) => updatePrefs({ config_dirs: dirs })}
      />

      {prefs.include_codex && (
        <>
          <Divider />
          <ConfigDirsSection
            provider="codex"
            dirs={prefs.codex_dirs}
            onChange={(dirs) => updatePrefs({ codex_dirs: dirs })}
          />
        </>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--heat-0)", margin: "8px 0" }} />;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 0",
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
        {description && (
          <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{description}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function ToggleButton({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", background: "var(--heat-0)", borderRadius: 6, padding: 2 }}>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            background: value === opt ? "var(--accent-purple)" : "transparent",
            color: value === opt ? "#fff" : "var(--text-secondary)",
          }}
        >
          {opt === "compact" ? "K/M" : "Full"}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: checked ? "var(--accent-purple)" : "var(--heat-0)",
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        background: "#fff",
        position: "absolute",
        top: 2,
        left: checked ? 18 : 2,
        transition: "left 0.2s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </div>
  );
}

const COLOR_MODE_IDS: ("system" | "light" | "dark")[] = ["system", "light", "dark"];
const COLOR_MODE_KEYS: Record<string, string> = {
  system: "settings.auto",
  light: "settings.light",
  dark: "settings.dark",
};

function ColorModeToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: "system" | "light" | "dark") => void;
}) {
  const t = useI18n();
  return (
    <div style={{ display: "flex", background: "var(--heat-0)", borderRadius: 6, padding: 2 }}>
      {COLOR_MODE_IDS.map((id) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            background: value === id ? "var(--accent-purple)" : "transparent",
            color: value === id ? "#fff" : "var(--text-secondary)",
          }}
        >
          {t(COLOR_MODE_KEYS[id])}
        </button>
      ))}
    </div>
  );
}

function LanguageSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: Locale) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Locale)}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "3px 6px",
        borderRadius: 4,
        border: "1px solid var(--heat-1)",
        cursor: "pointer",
        background: "var(--heat-0)",
        color: "var(--text-primary)",
        outline: "none",
      }}
    >
      {LANGUAGE_OPTIONS.map((lang) => (
        <option key={lang.id} value={lang.id}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}

function OAuthTokenSection({
  prefs,
  updatePrefs,
}: {
  prefs: ReturnType<typeof useSettings>["prefs"];
  updatePrefs: ReturnType<typeof useSettings>["updatePrefs"];
}) {
  const t = useI18n();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasToken = !!prefs.manual_oauth_token;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSave = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setSaving(true);
    updatePrefs({ manual_oauth_token: trimmed });
    // Give prefs a tick to persist, then trigger immediate usage fetch
    setTimeout(async () => {
      await invoke("refresh_oauth_usage").catch(() => null);
      setSaving(false);
      setEditing(false);
      setInput("");
    }, 400);
  };

  const handleClear = () => {
    updatePrefs({ manual_oauth_token: null });
    setEditing(false);
    setInput("");
  };

  const handleCancel = () => {
    setEditing(false);
    setInput("");
    setShowToken(false);
  };

  const btnStyle = (accent?: boolean): React.CSSProperties => ({
    fontSize: 10,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    background: accent ? "rgba(124, 92, 252, 0.12)" : "var(--heat-0)",
    color: accent ? "var(--accent-purple)" : "var(--text-secondary)",
  });

  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
        {t("settings.oauthToken")}
      </div>

      {!editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            fontSize: 10,
            color: hasToken ? "var(--text-secondary)" : "var(--text-muted)",
            flex: 1,
            fontWeight: 600,
          }}>
            {hasToken ? `${t("settings.oauthTokenSaved")} ✓` : t("settings.oauthTokenNone")}
          </div>
          <button style={btnStyle(true)} onClick={() => { setEditing(true); setInput(""); }}>
            {hasToken ? t("settings.oauthTokenChange") : t("settings.oauthTokenSet")}
          </button>
          {hasToken && (
            <button style={{ ...btnStyle(), color: "#ef4444" }} onClick={handleClear}>
              {t("settings.oauthTokenClear")}
            </button>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              ref={inputRef}
              type={showToken ? "text" : "password"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
              placeholder="sk-ant-oat01-..."
              style={{
                flex: 1,
                fontSize: 10,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid var(--heat-1)",
                background: "var(--heat-0)",
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "monospace",
                minWidth: 0,
              }}
            />
            <button
              onClick={() => setShowToken((v) => !v)}
              title={showToken ? "Hide" : "Show"}
              style={{
                ...btnStyle(),
                padding: "3px 6px",
                flexShrink: 0,
              }}
            >
              {showToken ? "●" : "○"}
            </button>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
            {t("settings.oauthTokenHint")}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            <button
              onClick={handleSave}
              disabled={!input.trim() || saving}
              style={{ ...btnStyle(true), opacity: (!input.trim() || saving) ? 0.5 : 1 }}
            >
              {saving ? t("settings.oauthTokenSaving") : t("settings.oauthTokenSave")}
            </button>
            <button style={btnStyle()} onClick={handleCancel}>
              {t("settings.oauthTokenCancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ConfigDirProvider = "claude" | "codex";

const DIR_CONFIG: Record<ConfigDirProvider, {
  titleKey: string;
  tooltipKey: string;
  detectCmd: string;
  validateCmd: string;
  defaultSubdir: string;
  invalidKey: string;
}> = {
  claude: {
    titleKey: "settings.configDirs",
    tooltipKey: "settings.configDirsTooltip",
    detectCmd: "detect_claude_dirs",
    validateCmd: "validate_claude_dir",
    defaultSubdir: ".claude",
    invalidKey: "settings.configDirsInvalid",
  },
  codex: {
    titleKey: "settings.codexConfigDirs",
    tooltipKey: "settings.codexConfigDirsTooltip",
    detectCmd: "detect_codex_dirs",
    validateCmd: "validate_codex_dir",
    defaultSubdir: ".codex",
    invalidKey: "settings.codexConfigDirsInvalid",
  },
};

function ConfigDirsSection({
  provider,
  dirs,
  onChange,
}: {
  provider: ConfigDirProvider;
  dirs: string[];
  onChange: (dirs: string[]) => void;
}) {
  const t = useI18n();
  const cfg = DIR_CONFIG[provider];
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState("");

  const showMessage = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 3000);
  }, []);

  const handleAutoDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const found = await invoke<string[]>(cfg.detectCmd);
      const newDirs = found.filter((d) => !dirs.includes(d));
      if (newDirs.length > 0) {
        onChange([...dirs, ...newDirs]);
        showMessage(t("settings.configDirsFound", { count: String(newDirs.length) }));
      } else {
        showMessage(t("settings.configDirsNotFound"));
      }
    } catch {
      showMessage(t("settings.configDirsNotFound"));
    } finally {
      setDetecting(false);
    }
  }, [dirs, onChange, showMessage, t, cfg.detectCmd]);

  const handleAddFolder = useCallback(async () => {
    try {
      await invoke("set_dialog_open", { open: true });
      const home = await invoke<string>("get_home_dir");
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: home ? `${home}/${cfg.defaultSubdir}` : undefined,
      });
      if (!selected) return;
      const homePath = selected.replace(/^\/Users\/[^/]+/, "~");
      if (dirs.includes(homePath) || dirs.includes(selected)) return;
      const valid = await invoke<boolean>(cfg.validateCmd, { path: homePath });
      if (valid) {
        onChange([...dirs, homePath]);
      } else {
        showMessage(t(cfg.invalidKey));
      }
    } finally {
      await invoke("set_dialog_open", { open: false });
    }
  }, [dirs, onChange, showMessage, t, cfg.validateCmd, cfg.defaultSubdir, cfg.invalidKey]);

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 8,
      }}>
        {t(cfg.titleKey)}
        <InfoTooltip>{t(cfg.tooltipKey)}</InfoTooltip>
      </div>

      <div style={{ maxHeight: 120, overflowY: "auto", marginBottom: 6 }}>
        {dirs.map((dir, i) => (
          <div
            key={dir}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "3px 0",
              fontSize: 11,
              color: "var(--text-primary)",
            }}
          >
            <span style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              fontWeight: 500,
            }}>
              {dir}
            </span>
            {i === 0 ? (
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--text-muted)",
                marginLeft: 4,
                flexShrink: 0,
              }}>
                ({t("settings.configDirsPrimary")})
              </span>
            ) : (
              <button
                onClick={() => onChange(dirs.filter((d) => d !== dir))}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--text-muted)",
                  flexShrink: 0,
                  marginLeft: 4,
                }}
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={handleAutoDetect}
          disabled={detecting}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 4,
            border: "none",
            cursor: detecting ? "wait" : "pointer",
            background: "var(--heat-0)",
            color: "var(--text-secondary)",
            opacity: detecting ? 0.6 : 1,
          }}
        >
          {detecting ? "..." : t("settings.configDirsAutoDetect")}
        </button>
        <button
          onClick={handleAddFolder}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            background: "var(--heat-0)",
            color: "var(--text-secondary)",
          }}
        >
          + {t("settings.configDirsAdd")}
        </button>
      </div>

      {message && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, fontWeight: 500 }}>
          {message}
        </div>
      )}
    </div>
  );
}
