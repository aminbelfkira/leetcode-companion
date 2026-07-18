export const LOG_PREFIX = "[lcfsrs]";

/** §5.3 — session par slug réinitialisée au-delà de cet âge. */
export const SESSION_MAX_AGE_H = 6;

/** §5.4 — marqueur de source des postMessage MAIN → ISOLATED. */
export const PAGE_MSG_SOURCE = "lcfsrs";

/** §8 — badge. */
export const BADGE_COLOR = "#ff5c5c";
export const ALARM_BADGE_PERIODIC = "lcfsrs-badge-periodic";
export const ALARM_BADGE_DAILY = "lcfsrs-badge-daily";
/** Alarme quotidienne à 00:05 locale (§8). */
export const DAILY_ALARM_HOUR = 0;
export const DAILY_ALARM_MINUTE = 5;

/** Retente les commits GitHub restés en file après une coupure réseau. */
export const ALARM_GITHUB_RETRY = "lcfsrs-github-retry";
export const GITHUB_RETRY_MINUTES = 15;
