// Monde MAIN (§4, §5.1) : patch fetch + XHR + history, relaie les événements
// utiles au content script ISOLATED via window.postMessage.
// Aucune écriture storage ici, aucune donnée hors métadonnées de soumission.

import { LOG_PREFIX, PAGE_MSG_SOURCE } from "../src/config";
import {
  CHECK_STATE_FINAL,
  CHECK_URL_RE,
  SUBMIT_URL_RE,
  type CheckResponse,
  type SubmitResponse,
} from "../src/lc-endpoints";
import type { PageEventPayloads, PageEventType } from "../src/types";

export default defineContentScript({
  matches: ["*://leetcode.com/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    /** Ids des vraies soumissions (POST submit/) de la page. Un id de « Run »
     *  (interpret_solution) n'y entre jamais → ses résultats check/ sont ignorés (§5.1). */
    const knownSubmissionIds = new Set<string>();

    function post<T extends PageEventType>(type: T, payload: PageEventPayloads[T]): void {
      window.postMessage({ source: PAGE_MSG_SOURCE, type, payload }, "*");
    }

    function handleResponse(method: string, url: string, bodyText: string): void {
      const submitMatch = method === "POST" ? SUBMIT_URL_RE.exec(url) : null;
      if (submitMatch) {
        const slug = submitMatch[1];
        const body = safeJson<SubmitResponse>(bodyText);
        if (slug && typeof body?.submission_id === "number") {
          knownSubmissionIds.add(String(body.submission_id));
          post("submission-created", { id: body.submission_id, slug });
        }
        return;
      }

      const checkMatch = CHECK_URL_RE.exec(url);
      if (checkMatch) {
        const id = checkMatch[1];
        if (!id || !knownSubmissionIds.has(id)) return; // Run, autre onglet, etc.
        const body = safeJson<CheckResponse>(bodyText);
        if (body?.state !== CHECK_STATE_FINAL) return; // PENDING / STARTED
        knownSubmissionIds.delete(id); // un seul verdict final par soumission
        post("submission-result", {
          id: Number(id),
          statusMsg: body.status_msg ?? "",
          statusCode: body.status_code ?? -1,
        });
      }
    }

    function safeJson<T>(text: string): T | null {
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    }

    // --- fetch ------------------------------------------------------------
    const origFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = input instanceof Request ? input.url : String(input);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const promise = origFetch.call(window, input, init);
      promise
        .then((res) => {
          if (!SUBMIT_URL_RE.test(url) && !CHECK_URL_RE.test(url)) return;
          res
            .clone()
            .text()
            .then((text) => handleResponse(method, url, text))
            .catch(() => {});
        })
        .catch(() => {}); // l'appelant garde la promesse d'origine, rejets inclus
      return promise;
    };

    // --- XMLHttpRequest ---------------------------------------------------
    interface PatchedXhr extends XMLHttpRequest {
      __lcfsrs?: { method: string; url: string };
    }
    const xhrProto = XMLHttpRequest.prototype;
    const origOpen = xhrProto.open;
    const origSend = xhrProto.send;

    xhrProto.open = function (
      this: PatchedXhr,
      ...args: Parameters<XMLHttpRequest["open"]>
    ): void {
      const [method, url] = args;
      this.__lcfsrs = { method: String(method).toUpperCase(), url: String(url) };
      origOpen.apply(this, args);
    } as typeof xhrProto.open;

    xhrProto.send = function (
      this: PatchedXhr,
      ...args: Parameters<XMLHttpRequest["send"]>
    ): void {
      const meta = this.__lcfsrs;
      if (meta && (SUBMIT_URL_RE.test(meta.url) || CHECK_URL_RE.test(meta.url))) {
        this.addEventListener("load", () => {
          try {
            handleResponse(meta.method, meta.url, this.responseText);
          } catch (err) {
            console.warn(`${LOG_PREFIX} interceptor XHR`, err);
          }
        });
      }
      origSend.apply(this, args);
    } as typeof xhrProto.send;

    // --- Navigation SPA (§5.3) -------------------------------------------
    function emitUrlChange(): void {
      post("url-change", { pathname: location.pathname });
    }

    const origPushState = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History["pushState"]>): void => {
      origPushState(...args);
      emitUrlChange();
    };
    const origReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<History["replaceState"]>): void => {
      origReplaceState(...args);
      emitUrlChange();
    };
    window.addEventListener("popstate", emitUrlChange);

    console.log(`${LOG_PREFIX} interceptor MAIN actif`);
  },
});
