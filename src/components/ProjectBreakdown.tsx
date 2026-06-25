import type { ProjectUsage } from "../lib/types";
import { formatTokens, formatCost } from "../lib/format";
import { useSettings } from "../contexts/SettingsContext";
import { useI18n } from "../i18n/I18nContext";

interface Props {
  data: ProjectUsage[];
}

const MAX_ITEMS = 6;
const SOURCE_COLORS = {
  claude: "#f97316",
  codex: "#0284c7",
} as const;

function sourceLabel(source: ProjectUsage["source"]) {
  if (source === "claude") return "Claude";
  if (source === "codex") return "Codex";
  return null;
}

export function ProjectBreakdown({ data }: Props) {
  const { prefs } = useSettings();
  const t = useI18n();

  const items = data.slice(0, MAX_ITEMS);
  if (items.length === 0) return null;

  const maxCost = items[0]?.cost_usd ?? 0;

  return (
    <div style={{
      background: "var(--bg-card)",
      borderRadius: "var(--radius-lg)",
      padding: 14,
      boxShadow: "var(--shadow-card)",
    }}>
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 10,
      }}>
        {t("analytics.projects.title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map((project) => {
          const barWidth = maxCost > 0 ? (project.cost_usd / maxCost) * 100 : 0;
          const color = project.source ? SOURCE_COLORS[project.source] : "var(--accent-purple)";
          const label = sourceLabel(project.source);
          return (
            <div key={`${project.source ?? "unknown"}:${project.name}`}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 8,
                alignItems: "baseline",
                marginBottom: 3,
              }}>
                <span style={{
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {label && (
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      height: 16,
                      padding: "0 6px",
                      borderRadius: 999,
                      background: color,
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 800,
                      marginRight: 6,
                      verticalAlign: "1px",
                    }}>
                      {label}
                    </span>
                  )}
                  {project.name}
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text-secondary)",
                    marginLeft: 4,
                  }}>
                    {project.sessions} {t("analytics.projects.sessions")}
                  </span>
                </span>
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                }}>
                  {formatCost(project.cost_usd)}
                  <span style={{ marginLeft: 6, fontSize: 11 }}>
                    {formatTokens(project.tokens, prefs.number_format)}
                  </span>
                </span>
              </div>
              <div style={{
                height: 7,
                borderRadius: 4,
                background: "var(--heat-0)",
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${barWidth}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: color,
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
