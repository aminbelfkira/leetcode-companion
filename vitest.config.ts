import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  // WxtVitest fournit les alias de WXT et remplace `browser` par `fakeBrowser`,
  // une implémentation en mémoire des API d'extension.
  plugins: [WxtVitest()],
});
