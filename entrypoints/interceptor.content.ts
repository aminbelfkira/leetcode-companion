// Monde MAIN (§4, §5.1) : patch fetch + XHR + history, relaie les événements
// utiles au content script ISOLATED via window.postMessage.
// Aucune écriture storage ici, aucune donnée hors métadonnées de soumission.

import { LOG_PREFIX, PAGE_MSG_SOURCE } from "../src/config";
import {
  acceptedVerdictFromGraphqlResponse,
  isGraphqlEndpoint,
  isFinalCheckResponse,
  parseCheckEndpoint,
  parseSubmitEndpoint,
  statusCodeForEvent,
  statusMessageForEvent,
  submissionIdFromGraphqlRequestBody,
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
    /** Empêche les doubles événements quand LeetCode rejoue le même transport. */
    const observedSubmissionIds = new Set<string>();
    const MAX_OBSERVED_SUBMISSIONS = 128;
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

    function receiveFinalVerdict(id: string, response: CheckResponse): void {
      if (knownSubmissionIds.has(id)) {
        postSubmissionResult(id, response);
        return;
      }
      // Le même garde-fou couvre un poll historique ou la réponse GraphQL
      // qui arriverait avant que le body de submit soit lu.
      earlyFinalChecks.set(id, { response, receivedAt: Date.now() });
      pruneEarlyFinalChecks();
    }

    function rememberSubmission(id: string, slug: string): void {
      pruneEarlyFinalChecks();
      if (observedSubmissionIds.has(id)) return;
      observedSubmissionIds.add(id);
      while (observedSubmissionIds.size > MAX_OBSERVED_SUBMISSIONS) {
        const oldestId = observedSubmissionIds.values().next().value;
        if (oldestId === undefined) break;
        observedSubmissionIds.delete(oldestId);
      }
      knownSubmissionIds.add(id);
      post("submission-created", { id, slug });

      const earlyCheck = earlyFinalChecks.get(id);
      if (earlyCheck !== undefined) postSubmissionResult(id, earlyCheck.response);
    }

    function handleResponse(
      method: string,
      url: string,
      bodyText: string,
      graphqlSubmissionId: string | null,
    ): void {
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
        receiveFinalVerdict(id, body);
        return;
      }

      if (graphqlSubmissionId !== null) {
        const accepted = acceptedVerdictFromGraphqlResponse(safeJson<unknown>(bodyText));
        if (accepted !== null) {
          console.log(`${LOG_PREFIX} verdict GraphQL détecté`, { id: graphqlSubmissionId });
          receiveFinalVerdict(graphqlSubmissionId, accepted);
        }
      }
    }

    function safeJson<T>(text: string): T | null {
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    }

    /**
     * LeetCode configure certaines requêtes GraphQL en `responseType = "blob"`.
     * Accéder à `responseText` dans ce cas lève un InvalidStateError et empêchait
     * donc tout traitement du verdict. On convertit uniquement la réponse des
     * requêtes déjà identifiées comme pertinentes, sans jamais journaliser ni
     * conserver son contenu.
     */
    async function textFromXhrResponse(xhr: XMLHttpRequest): Promise<string | null> {
      switch (xhr.responseType) {
        case "":
        case "text":
          return xhr.responseText;
        case "json":
          return xhr.response === null ? null : JSON.stringify(xhr.response);
        case "blob":
          return xhr.response instanceof Blob ? xhr.response.text() : null;
        case "arraybuffer":
          return xhr.response instanceof ArrayBuffer
            ? new TextDecoder().decode(xhr.response)
            : null;
        default:
          return null;
      }
    }

    interface PatchedXhr extends XMLHttpRequest {
      __lcfsrs?: {
        method: string;
        url: string;
        graphqlSubmissionId: string | null;
      };
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
        const graphqlSubmissionId = isGraphqlEndpoint(url)
          ? submissionIdFromGraphqlRequestBody(init?.body)
          : null;
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const promise = originalFetch.call(window, input, init);
        promise
          .then((res) => {
            if (
              parseSubmitEndpoint(url) === null &&
              parseCheckEndpoint(url) === null &&
              graphqlSubmissionId === null
            ) {
              return;
            }
            void res
              .clone()
              .text()
              .then((text) => handleResponse(method, url, text, graphqlSubmissionId))
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
        this.__lcfsrs = {
          method: String(method).toUpperCase(),
          url: String(url),
          graphqlSubmissionId: null,
        };
        originalOpen.apply(this, args);
      });
      const patchedSend = markPatched(function (
        this: PatchedXhr,
        ...args: Parameters<XMLHttpRequest["send"]>
      ): void {
        const meta = this.__lcfsrs;
        if (meta !== undefined && isGraphqlEndpoint(meta.url)) {
          meta.graphqlSubmissionId = submissionIdFromGraphqlRequestBody(args[0]);
        }
        if (
          meta !== undefined &&
          (parseSubmitEndpoint(meta.url) !== null ||
            parseCheckEndpoint(meta.url) !== null ||
            meta.graphqlSubmissionId !== null)
        ) {
          this.addEventListener(
            "load",
            () => {
              void textFromXhrResponse(this)
                .then((text) => {
                  if (text !== null) {
                    handleResponse(
                      meta.method,
                      meta.url,
                      text,
                      meta.graphqlSubmissionId,
                    );
                  }
                })
                .catch((err: unknown) => {
                  console.warn(`${LOG_PREFIX} interceptor XHR`, err);
                });
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
