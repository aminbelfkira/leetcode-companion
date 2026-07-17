// Petit wrapper typé autour de chrome.runtime.sendMessage (content/popup → background).
// (Fichier hors arborescence §4, ajouté pour typer les échanges — signalé à Amin.)

import { browser } from "wxt/browser";
import type { RuntimeRequest, RuntimeResponse, RuntimeResponseMap } from "./types";

export async function sendToBackground<K extends RuntimeRequest["kind"]>(
  request: Extract<RuntimeRequest, { kind: K }>,
): Promise<RuntimeResponseMap[K]> {
  const response = (await browser.runtime.sendMessage(request)) as RuntimeResponse<K>;
  if (typeof response === "object" && response !== null && "error" in response) {
    throw new Error(response.error);
  }
  return response;
}
