// Monde MAIN NeetCode : observe fetch/XHR et relaie uniquement les départs de
// soumission, les verdicts et les changements d'URL. Le code (`rawCode`) n'est
// jamais extrait, journalisé ni transmis.

import { LOG_PREFIX, PAGE_MSG_SOURCE } from "../src/config";
import {
  problemSlugFromPathname,
  submitKindForRequest,
  verdictFromResponse,
  type SubmitKind,
} from "../src/nc-endpoints";
import type { NcPageEventPayloads, NcPageEventType } from "../src/types";

interface SubmitDescriptor {
  token: string;
  slug: string | null;
  kind: SubmitKind;
}

export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    let nextToken = 1;

    function post<T extends NcPageEventType>(
      type: T,
      payload: NcPageEventPayloads[T],
    ): void {
      window.postMessage({ source: PAGE_MSG_SOURCE, type, payload }, "*");
    }

    /** Le slug vient de l'URL de la page, jamais du champ contenant le code. */
    function describeSubmit(
      method: string,
      url: string,
      body: string | null,
    ): SubmitDescriptor | null {
      const kind = submitKindForRequest(method, url, body);
      if (kind === null) return null;
      return {
        token: String(nextToken++),
        slug: problemSlugFromPathname(location.pathname),
        kind,
      };
    }

    function announceSubmit(descriptor: SubmitDescriptor): void {
      post("submission-created", { token: descriptor.token, slug: descriptor.slug });
    }

    function announceVerdict(descriptor: SubmitDescriptor, body: string): void {
      const verdict = verdictFromResponse(body);
      if (verdict === null) {
        console.warn(`${LOG_PREFIX} réponse NeetCode sans verdict exploitable`);
        return;
      }
      post("submission-result", {
        token: descriptor.token,
        slug: descriptor.slug,
        statusDescription: verdict.statusDescription,
        testCaseCount: verdict.testCaseCount,
        correctTestCaseCount: verdict.correctTestCaseCount,
      });
    }

    type MarkedFunction = { __lcfsrsNeetcodePatched?: boolean };

    function isAlreadyPatched(value: unknown): boolean {
      return (
        typeof value === "function" &&
        (value as MarkedFunction).__lcfsrsNeetcodePatched === true
      );
    }

    function markPatched<T>(fn: T): T {
      Object.defineProperty(fn as object, "__lcfsrsNeetcodePatched", { value: true });
      return fn;
    }

    function installFetchInterceptor(): void {
      if (isAlreadyPatched(window.fetch)) return;
      const originalFetch = window.fetch;
      window.fetch = markPatched(function (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const url = input instanceof Request ? input.url : String(input);
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const body = typeof init?.body === "string" ? init.body : null;
        const descriptor = describeSubmit(method, url, body);
        const promise = originalFetch.call(window, input, init);
        if (descriptor === null) return promise;

        announceSubmit(descriptor);
        promise
          .then((response) => {
            void response
              .clone()
              .text()
              .then((text) => announceVerdict(descriptor, text))
              .catch(() => {});
          })
          .catch(() => {});
        return promise;
      });
    }

    /** Convertit seulement la réponse d'une requête déjà reconnue. */
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
      __lcfsrsNeetcode?: { method: string; url: string };
    }

    function installXhrInterceptor(): void {
      const proto = XMLHttpRequest.prototype;
      if (isAlreadyPatched(proto.open) && isAlreadyPatched(proto.send)) return;

      const originalOpen = proto.open;
      const originalSend = proto.send;
      const patchedOpen = markPatched(function (
        this: PatchedXhr,
        ...args: Parameters<XMLHttpRequest["open"]>
      ): void {
        this.__lcfsrsNeetcode = { method: String(args[0]), url: String(args[1]) };
        originalOpen.apply(this, args);
      });
      const patchedSend = markPatched(function (
        this: PatchedXhr,
        ...args: Parameters<XMLHttpRequest["send"]>
      ): void {
        const metadata = this.__lcfsrsNeetcode;
        const body = typeof args[0] === "string" ? args[0] : null;
        const descriptor =
          metadata === undefined
            ? null
            : describeSubmit(metadata.method, metadata.url, body);
        if (descriptor !== null) {
          announceSubmit(descriptor);
          this.addEventListener(
            "load",
            () => {
              void textFromXhrResponse(this)
                .then((text) => {
                  if (text !== null) announceVerdict(descriptor, text);
                })
                .catch((error: unknown) =>
                  console.warn(`${LOG_PREFIX} intercepteur XHR NeetCode`, error),
                );
            },
            { once: true },
          );
        }
        originalSend.apply(this, args);
      });

      proto.open = patchedOpen as typeof proto.open;
      proto.send = patchedSend as typeof proto.send;
    }

    function installNetworkInterceptors(): void {
      try {
        installFetchInterceptor();
      } catch (error) {
        console.warn(`${LOG_PREFIX} installation fetch NeetCode`, error);
      }
      try {
        installXhrInterceptor();
      } catch (error) {
        console.warn(`${LOG_PREFIX} installation XHR NeetCode`, error);
      }
    }

    installNetworkInterceptors();
    if (document.readyState !== "complete") {
      window.addEventListener("load", installNetworkInterceptors, { once: true });
    }

    function emitUrlChange(): void {
      post("url-change", { pathname: location.pathname, search: location.search });
    }

    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History["pushState"]>): void => {
      originalPushState(...args);
      emitUrlChange();
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<History["replaceState"]>): void => {
      originalReplaceState(...args);
      emitUrlChange();
    };
    window.addEventListener("popstate", emitUrlChange);

    console.log(`${LOG_PREFIX} intercepteur MAIN NeetCode actif`);
  },
});
