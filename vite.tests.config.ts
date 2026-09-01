import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Le projet conserve son runner top-level vite-node. Pour les modules métier
  // qui importent wxt/browser, on branche explicitement l'API mémoire de WXT.
  resolve: {
    alias: {
      "wxt/browser": fileURLToPath(new URL("./tests/wxt-browser.ts", import.meta.url)),
    },
  },
});
