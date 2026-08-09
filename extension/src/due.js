// Formatage des échéances — pur, sans dépendance à ts-fsrs ni aux API extension.
// Utilisé par le panneau, le bandeau, le popup.

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;
  const DAY_MS = 86_400_000;

  NCC.DAY_MS = DAY_MS;

  /** Nombre de jours (arrondi sup., min 0) entre `now` et une due ISO. */
  NCC.daysUntil = function daysUntil(dueIso, now = new Date()) {
    return Math.max(0, Math.ceil((new Date(dueIso).getTime() - now.getTime()) / DAY_MS));
  };

  /** « aujourd'hui » / « demain » / « dans {n} j » pour l'UI. */
  NCC.formatDueRelative = function formatDueRelative(dueIso, now = new Date()) {
    const days = NCC.daysUntil(dueIso, now);
    if (days <= 0) return "aujourd'hui";
    if (days === 1) return "demain";
    return `dans ${days} j`;
  };
})();
