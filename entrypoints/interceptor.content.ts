// Monde MAIN (§4, §5.1) : patch fetch + XHR + history, relaie les événements
// utiles au content script ISOLATED via window.postMessage.
// Aucune écriture storage ici, aucune donnée hors métadonnées de soumission.

import { LOG_PREFIX, PAGE_MSG_SOURCE } from "../src/config";
import {
  isFinalCheckResponse,
  parseCheckEndpoint,
  parseSubmitEndpoint,
  statusCodeForEvent,
  statusMessageForEvent,
  submissionIdFromResponse,
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
    /**
     * Un poll peut, sur un verdict très rapide, finir avant la lecture du body
     * de la réponse submit. On le garde brièvement, puis on le traite seulement
     * si l'id apparaît bien dans une vraie soumission — jamais pour « Run ».
     */
    const earlyFinalChecks = new Map<
      string,
      { response: CheckResponse; receivedAt: number }
    >();
    const EARLY_CHECK_TTL_MS = 30_000;
    const MAX_EARLY_CHECKS = 32;

    function post<T extends PageEventType>(type: T, payload: PageEventPayloads[T]): void {
      window.postMessage({ source: PAGE_MSG_SOURCE, type, payload }, "*");
    }

    function pruneEarlyFinalChecks(): void {
      const oldestAllowed = Date.now() - EARLY_CHECK_TTL_MS;
      for (const [id, entry] of earlyFinalChecks) {
        if (entry.receivedAt < oldestAllowed) earlyFinalChecks.delete(id);
      }
      while (earlyFinalChecks.size > MAX_EARLY_CHECKS) {
        const oldestId = earlyFinalChecks.keys().next().value;
        if (oldestId === undefined) break;
        earlyFinalChecks.delete(oldestId);
      }
    }

    function postSubmissionResult(id: string, response: CheckResponse): void {
      knownSubmissionIds.delete(id); // un seul verdict final par soumission
      earlyFinalChecks.delete(id);
      post("submission-result", {
        id,
        statusMsg: statusMessageForEvent(response.status_msg),
        statusCode: statusCodeForEvent(response.status_code),
      });
    }

    function rememberSubmission(id: string, slug: string): void {
      pruneEarlyFinalChecks();
      knownSubmissionIds.add(id);
      post("submission-created", { id, slug });

      const earlyCheck = earlyFinalChecks.get(id);
      if (earlyCheck !== undefined) postSubmissionResult(id, earlyCheck.response);
    }

    function handleResponse(method: string, url: string, bodyText: string): void {
      const submit = method === "POST" ? parseSubmitEndpoint(url) : null;
      if (submit !== null) {
        const id = submissionIdFromResponse(safeJson<SubmitResponse>(bodyText));
        if (id === null) {
          console.warn(`${LOG_PREFIX} réponse submit sans submission_id exploitable`, { url });
          return;
        }
        rememberSubmission(id, submit.slug);
        return;
      }

      const check = parseCheckEndpoint(url);
      if (check !== null) {
        const { id } = check;
        const body = safeJson<CheckResponse>(bodyText);
        if (body === null || !isFinalCheckResponse(body)) return; // PENDING / STARTED
        if (knownSubmissionIds.has(id)) {
          postSubmissionResult(id, body);
          return;
        }

        // Il peut s'agir de Run : aucune émission tant qu'un vrai submit ne
        // confirme pas ce même id. Le cache est borné et expire après 30 s.
        earlyFinalChecks.set(id, { response: body, receivedAt: Date.now() });
        pruneEarlyFinalChecks();
      }
    }

    function safeJson<T>(text: string): T | null {
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    }

    interface PatchedXhr extends XMLHttpRequest {
      __lcfsrs?: { method: string; url: string };
    }

    type MarkedFunction = { __lcfsrsPatched?: boolean };
    function isAlreadyPatched(value: unknown): boolean {
      return (
        typeof value === "function" &&
        (value as MarkedFunction).__lcfsrsPatched === true
      );
    }

    function markPatched<T>(fn: T): T {
      Object.defineProperty(fn as object, "__lcfsrsPatched", { value: true });
      return fn;
    }

    // --- fetch ------------------------------------------------------------
    function installFetchInterceptor(): void {
      if (isAlreadyPatched(window.fetch)) return;
      const originalFetch = window.fetch;
      const patchedFetch = markPatched(function (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const url = input instanceof Request ? input.url : String(input);
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const promise = originalFetch.call(window, input, init);
        promise
          .then((res) => {
            if (parseSubmitEndpoint(url) === null && parseCheckEndpoint(url) === null) return;
            void res
              .clone()
              .text()
              .then((text) => handleResponse(method, url, text))
              .catch(() => {});
          })
          .catch(() => {}); // l'appelant garde la promesse d'origine, rejets inclus
        return promise;
      });
      window.fetch = patchedFetch;
    }

    // --- XMLHttpRequest ---------------------------------------------------
    function installXhrInterceptor(): void {
      const xhrProto = XMLHttpRequest.prototype;
      if (isAlreadyPatched(xhrProto.open) && isAlreadyPatched(xhrProto.send)) return;

      const originalOpen = xhrProto.open;
      const originalSend = xhrProto.send;
      const patchedOpen = markPatched(function (
        this: PatchedXhr,
        ...args: Parameters<XMLHttpRequest["open"]>
      ): void {
        const [method, url] = args;
        this.__lcfsrs = { method: String(method).toUpperCase(), url: String(url) };
        originalOpen.apply(this, args);
      });
      const patchedSend = markPatched(function (
        this: PatchedXhr,
        ...args: Parameters<XMLHttpRequest["send"]>
      ): void {
        const meta = this.__lcfsrs;
        if (
          meta !== undefined &&
          (parseSubmitEndpoint(meta.url) !== null || parseCheckEndpoint(meta.url) !== null)
        ) {
          this.addEventListener(
            "load",
            () => {
              try {
                handleResponse(meta.method, meta.url, this.responseText);
              } catch (err) {
                console.warn(`${LOG_PREFIX} interceptor XHR`, err);
              }
            },
            { once: true },
          );
        }
        originalSend.apply(this, args);
      });
      xhrProto.open = patchedOpen as typeof xhrProto.open;
      xhrProto.send = patchedSend as typeof xhrProto.send;
    }

    /**
     * document_start couvre le cas normal. Le second passage après load évite
     * qu'un bundle LeetCode qui remplace fetch/XHR pendant son bootstrap ne
     * désactive silencieusement l'interception.
     */
    function installNetworkInterceptors(): void {
      try {
        installFetchInterceptor();
      } catch (err) {
        // Ne jamais perdre le fallback XHR parce qu'un site a figé fetch.
        console.warn(`${LOG_PREFIX} installation fetch`, err);
      }
      try {
        installXhrInterceptor();
      } catch (err) {
        console.warn(`${LOG_PREFIX} installation XHR`, err);
      }
    }

    installNetworkInterceptors();
    if (document.readyState !== "complete") {
      window.addEventListener("load", installNetworkInterceptors, { once: true });
    }

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
