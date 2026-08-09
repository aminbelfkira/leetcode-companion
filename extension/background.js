// Point d'entrée du service worker MV3.
// Service worker classique (pas de module) : importScripts fonctionne partout,
// y compris dans Safari, sans dépendre du support des modules ES.

importScripts(
  "/vendor/ts-fsrs.umd.js",
  "/src/config.js",
  "/src/due.js",
  "/src/storage.js",
  "/src/fsrs.js",
  "/src/background-core.js",
);

self.NCC.startBackground();
