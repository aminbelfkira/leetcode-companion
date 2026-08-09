// Wrapper typé autour de browser.runtime.sendMessage (content, popup, options
// vers background). Le background répond soit avec sa charge utile, soit avec
// { error }, converti ici en exception.

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
