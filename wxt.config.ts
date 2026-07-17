import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: {
    name: "LeetCode × FSRS",
    description:
      "Révision espacée (FSRS) pour LeetCode — 100 % locale, zéro compte, zéro serveur.",
    permissions: ["storage", "alarms", "tabs"],
    host_permissions: ["https://leetcode.com/*"],
  },
});
