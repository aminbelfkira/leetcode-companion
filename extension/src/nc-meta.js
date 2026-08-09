// Métadonnées du problème (titre, difficulté) + fallbacks DOM.
// À appeler depuis le content script ISOLATED : même origine que neetcode.io.

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;
  // Chemin relatif : le content script n'est injecté que sur neetcode.io, et
  // le harnais de test peut ainsi exercer le vrai chemin d'appel.
  const METADATA_PATH = "/api/getProblemMetadataFunctionHttp";
  const cache = new Map();

  /**
   * `{"data":{"problemId":"duplicate-integer"}}` → `{ id, name, difficulty, … }`.
   * L'endpoint répond sans authentification ; seuls trois champs sont lus.
   */
  async function fetchProblemMeta(slug) {
    const response = await fetch(METADATA_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { problemId: slug } }),
    });
    if (!response.ok) return null;

    const json = await response.json();
    const data = json && typeof json === "object" ? json.data : null;
    if (!data || typeof data.name !== "string" || data.name.trim() === "") return null;
    return {
      title: data.name.trim(),
      ncDifficulty: NCC.parseDifficulty(data.difficulty),
      metaIncomplete: false,
    };
  }

  /** Fallback : titre h1 / document.title, difficulté lue sur la pastille. */
  function metaFromDocument(slug) {
    const heading = document.querySelector("h1");
    const headingTitle = heading?.textContent?.trim();
    const documentTitle = /^(.+?)\s*-\s*NeetCode\s*$/.exec(document.title)?.[1]?.trim();
    const title = headingTitle || documentTitle || slug;

    const pill = document.querySelector(".difficulty-pill");
    const pillText = pill?.textContent?.trim() ?? "";
    const normalized =
      pillText.charAt(0).toUpperCase() + pillText.slice(1).toLowerCase();

    return {
      title,
      ncDifficulty: NCC.parseDifficulty(normalized),
      metaIncomplete: true,
    };
  }

  /** API d'abord, sinon DOM, sinon slug brut — ne rejette jamais. */
  NCC.resolveMeta = async function resolveMeta(slug) {
    const cached = cache.get(slug);
    if (cached !== undefined) return cached;
    try {
      const meta = await fetchProblemMeta(slug);
      if (meta !== null) {
        cache.set(slug, meta);
        return meta;
      }
    } catch {
      // silencieux : fallback ci-dessous
    }
    return metaFromDocument(slug);
  };
})();
