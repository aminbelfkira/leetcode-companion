// Constantes partagées (content scripts, background, popup, options).
// Chargé en script classique : tout est attaché au namespace global NCC.

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;

  NCC.LOG_PREFIX = "[nccfsrs]";

  /** Session par slug réinitialisée au-delà de cet âge. */
  NCC.SESSION_MAX_AGE_H = 6;

  /** Marqueur de source des postMessage MAIN → ISOLATED. */
  NCC.PAGE_MSG_SOURCE = "nccfsrs";

  NCC.BADGE_COLOR = "#ff5c5c";
  NCC.ALARM_BADGE_PERIODIC = "nccfsrs-badge-periodic";
  NCC.ALARM_BADGE_DAILY = "nccfsrs-badge-daily";
  /** Alarme quotidienne à 00:05 locale. */
  NCC.DAILY_ALARM_HOUR = 0;
  NCC.DAILY_ALARM_MINUTE = 5;

  /** Safari expose `browser`, Chrome uniquement `chrome`. */
  NCC.browser = self.browser || self.chrome;
})();
