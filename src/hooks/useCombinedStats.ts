import { useMemo } from "react";
import { useTokenStats } from "./useTokenStats";
import type { AllStats, DailyUsage, ModelUsage, ProjectUsage } from "../lib/types";

interface UseCombinedStatsProps {
  includeClaude: boolean;
  includeCodex: boolean;
}

type SourceName = "claude" | "codex";
interface SourceStats {
  source: SourceName;
  stats: AllStats;
}

export function useCombinedStats({ includeClaude, includeCodex }: UseCombinedStatsProps) {
  const claude = useTokenStats("claude");
  const codex = useTokenStats("codex");

  const stats = useMemo<AllStats | null>(() => {
    const sources: (SourceStats | null)[] = [];
    if (includeClaude && claude.stats) sources.push({ source: "claude", stats: claude.stats });
    if (includeCodex && codex.stats) sources.push({ source: "codex", stats: codex.stats });

    const validStats = sources.filter((s): s is SourceStats => s !== null);
    if (validStats.length === 0) {
      if (includeClaude) return claude.stats;
      if (includeCodex) return codex.stats;
      return null;
    }
    if (validStats.length === 1) return tagStatsProjects(validStats[0].stats, validStats[0].source);

    return mergeStats(validStats);
  }, [claude.stats, codex.stats, includeClaude, includeCodex]);

  const loading = (includeClaude && claude.loading) || (includeCodex && codex.loading);
  const error = useMemo(() => {
    if (stats) return null;

    if (includeClaude && claude.error) return claude.error;
    if (includeCodex && codex.error) return codex.error;

    return null;
  }, [stats, includeClaude, includeCodex, claude.error, codex.error]);

  return { stats, loading, error };
}

function mergeStats(statsList: SourceStats[]): AllStats {
  const dailyMap = new Map<string, DailyUsage>();
  const modelUsage: Record<string, ModelUsage> = {};
  let totalMessages = 0;
  let totalSessions = 0;
  let firstDate: string | null = null;

  for (const { stats: s } of statsList) {
    totalMessages += s.total_messages;
    totalSessions += s.total_sessions;

    if (s.first_session_date && (!firstDate || s.first_session_date < firstDate)) {
      firstDate = s.first_session_date;
    }

    for (const d of s.daily) {
      const existing = dailyMap.get(d.date);
      if (existing) {
        for (const [model, tokens] of Object.entries(d.tokens)) {
          existing.tokens[model] = (existing.tokens[model] ?? 0) + tokens;
        }
        existing.cost_usd += d.cost_usd;
        existing.messages += d.messages;
        existing.sessions += d.sessions;
        existing.tool_calls += d.tool_calls;
        existing.input_tokens += d.input_tokens;
        existing.output_tokens += d.output_tokens;
        existing.cache_read_tokens += d.cache_read_tokens;
        existing.cache_write_tokens += d.cache_write_tokens;
      } else {
        dailyMap.set(d.date, {
          date: d.date,
          tokens: { ...d.tokens },
          cost_usd: d.cost_usd,
          messages: d.messages,
          sessions: d.sessions,
          tool_calls: d.tool_calls,
          input_tokens: d.input_tokens,
          output_tokens: d.output_tokens,
          cache_read_tokens: d.cache_read_tokens,
          cache_write_tokens: d.cache_write_tokens,
        });
      }
    }

    for (const [model, usage] of Object.entries(s.model_usage)) {
      const e = modelUsage[model];
      if (e) {
        e.input_tokens += usage.input_tokens;
        e.output_tokens += usage.output_tokens;
        e.cache_read += usage.cache_read;
        e.cache_write += usage.cache_write;
        e.cost_usd += usage.cost_usd;
      } else {
        modelUsage[model] = { ...usage };
      }
    }
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const analytics = mergeAnalytics(statsList);
  const rate_limits = statsList.find(({ stats }) => stats.rate_limits)?.stats.rate_limits;

  return {
    daily,
    model_usage: modelUsage,
    total_sessions: totalSessions,
    total_messages: totalMessages,
    first_session_date: firstDate,
    analytics,
    rate_limits,
  };
}

function tagStatsProjects(stats: AllStats, source: SourceName): AllStats {
  if (!stats.analytics) return stats;
  return {
    ...stats,
    analytics: {
      ...stats.analytics,
      project_usage: stats.analytics.project_usage.map(project => ({ ...project, source })),
    },
  };
}

function mergeAnalytics(statsList: SourceStats[]): AllStats["analytics"] {
  const projectMap = new Map<string, ProjectUsage>();
  const firstAnalytics = statsList.find(({ stats }) => stats.analytics)?.stats.analytics;

  for (const { source, stats } of statsList) {
    for (const project of stats.analytics?.project_usage ?? []) {
      const key = `${source}:${project.name}`;
      const existing = projectMap.get(key);
      if (existing) {
        existing.cost_usd += project.cost_usd;
        existing.tokens += project.tokens;
        existing.sessions += project.sessions;
        existing.messages += project.messages;
      } else {
        projectMap.set(key, { ...project, source });
      }
    }
  }

  if (!firstAnalytics && projectMap.size === 0) return undefined;

  return {
    project_usage: Array.from(projectMap.values()).sort((a, b) => b.cost_usd - a.cost_usd),
    tool_usage: firstAnalytics?.tool_usage ?? [],
    shell_commands: firstAnalytics?.shell_commands ?? [],
    mcp_usage: firstAnalytics?.mcp_usage ?? [],
    activity_breakdown: firstAnalytics?.activity_breakdown ?? [],
  };
}
