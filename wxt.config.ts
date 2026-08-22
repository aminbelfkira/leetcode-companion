import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: {
    name: "Companion",
    description:
      "Révision espacée FSRS unifiée pour LeetCode et NeetCode, sans cartes en double.",
    permissions: ["storage", "alarms", "tabs"],
    host_permissions: ["https://neetcode.io/*", "https://leetcode.com/*"],
    // L'intercepteur doit s'exécuter dans le contexte de la page : il est
    // injecté par le content script, donc servi comme ressource accessible.
    web_accessible_resources: [
      { resources: ["interceptor.js"], matches: ["https://neetcode.io/*"] },
    ],
  },
});
