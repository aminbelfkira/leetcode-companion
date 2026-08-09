import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: {
    name: "NeetCode Companion",
    description:
      "Révision espacée FSRS pour NeetCode : après chaque Accepted, note le problème et planifie sa prochaine révision.",
    permissions: ["storage", "alarms", "tabs"],
    host_permissions: ["https://neetcode.io/*"],
    // L'intercepteur doit s'exécuter dans le contexte de la page : il est
    // injecté par le content script, donc servi comme ressource accessible.
    web_accessible_resources: [
      { resources: ["interceptor.js"], matches: ["https://neetcode.io/*"] },
    ],
  },
});
