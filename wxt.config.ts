import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "output",
  manifest: () => {
    let supabasePermission: string[] = [];
    const configuredUrl = import.meta.env.WXT_SUPABASE_URL?.trim();
    if (configuredUrl) {
      try {
        const url = new URL(configuredUrl);
        if (url.protocol === "https:") supabasePermission = [`${url.origin}/*`];
      } catch {
        // Le module Supabase restera indisponible et l'ecran de reglages l'expliquera.
      }
    }
    return {
      name: "Companion",
      description:
        "Révision FSRS LeetCode et NeetCode, synchronisation Supabase et GitHub Sync LeetCode.",
      permissions: ["storage", "alarms", "identity"],
      host_permissions: [
        "https://leetcode.com/*",
        "https://neetcode.io/*",
        ...supabasePermission,
      ],
      optional_host_permissions: ["https://github.com/*", "https://api.github.com/*"],
    };
  },
});
