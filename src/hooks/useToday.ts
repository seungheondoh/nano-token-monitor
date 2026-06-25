import { useState, useEffect } from "react";
import { toLocalDateStr } from "../lib/format";

/**
 * Returns the current local date string (YYYY-MM-DD) and
 * automatically updates at midnight.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => toLocalDateStr(new Date()));

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;

    function scheduleNextMidnight() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 0, 0);
      const ms = midnight.getTime() - now.getTime() + 100; // +100ms buffer

      timerId = setTimeout(() => {
        setToday(toLocalDateStr(new Date()));
        scheduleNextMidnight();
      }, ms);
    }

    scheduleNextMidnight();
    return () => clearTimeout(timerId);
  }, []);

  return today;
}
