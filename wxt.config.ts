import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: {
    name: "LeetCode Companion",
    description:
      "Révision espacée FSRS et synchronisation GitHub optionnelle pour LeetCode.",
    permissions: ["storage", "alarms"],
    host_permissions: ["https://leetcode.com/*"],
    optional_host_permissions: ["https://github.com/*", "https://api.github.com/*"],
  },
});
