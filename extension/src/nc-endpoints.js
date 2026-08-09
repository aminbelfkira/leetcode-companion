// Tout ce qui touche aux URLs et aux endpoints non documentés de neetcode.io.
// Pur : aucune API extension, aucun accès storage.
//
// ⚠️ Les constantes d'endpoints sont dupliquées dans entrypoints/interceptor.js,
// qui s'exécute dans le monde MAIN et ne peut donc pas lire ce fichier.
// Toute modification ici doit y être répercutée.

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;

  NCC.NC_ORIGIN = "https://neetcode.io";

  /** Pages problème : /problems/{slug}, /problems/{slug}/question, … */
  const PROBLEM_PATH_RE = /^\/problems\/([^/]+)(?:\/|$)/;

  NCC.problemSlugFromPathname = function problemSlugFromPathname(pathname) {
    const match = PROBLEM_PATH_RE.exec(pathname);
    return match ? match[1] : null;
  };

  /** URL d'ouverture d'un problème depuis la file de révision. */
  NCC.reviewProblemUrl = function reviewProblemUrl(slug) {
    return `${NCC.NC_ORIGIN}/problems/${encodeURIComponent(slug)}/question`;
  };

  /**
   * NeetCode renvoie le verdict dans `status.description`. Contrairement à
   * LeetCode il n'y a pas de code numérique à recouper : la chaîne fait foi.
   */
  NCC.STATUS_ACCEPTED = "Accepted";

  NCC.isAcceptedVerdict = function isAcceptedVerdict(statusDescription) {
    return (
      typeof statusDescription === "string" &&
      statusDescription.trim().toLowerCase() === NCC.STATUS_ACCEPTED.toLowerCase()
    );
  };

  /**
   * Contexte de liste exposé par NeetCode, par exemple ?list=neetcode150.
   * Conservé sur la carte à titre informatif uniquement.
   */
  NCC.listSlugFromSearch = function listSlugFromSearch(search) {
    const value = new URLSearchParams(search).get("list");
    if (!value) return null;
    const slug = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug) ? slug : null;
  };

  NCC.parseDifficulty = function parseDifficulty(value) {
    return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
  };
})();
