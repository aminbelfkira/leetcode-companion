// Script injecté dans le contexte de la page (monde MAIN) par le content
// script : patch de fetch et de XMLHttpRequest, puis relais des événements
// utiles via window.postMessage.
//
// Un content script possède son propre XMLHttpRequest et ne verrait donc rien
// des requêtes d'Angular : ce détour est la seule façon de les observer.
//
// Aucune écriture storage ici. Le code source de l'utilisateur (`rawCode`)
// n'est jamais lu, ni journalisé, ni transmis.

import { LOG_PREFIX, PAGE_MSG_SOURCE } from "../src/config";
import {
  problemSlugFromPathname,
  submitKindForRequest,
  verdictFromResponse,
  type SubmitKind,
} from "../src/nc-endpoints";
import type { PageEventPayloads, PageEventType } from "../src/types";

interface SubmitDescriptor {
  token: string;
  slug: string | null;
  kind: SubmitKind;
}

export default defineUnlistedScript(() => {
  let nextToken = 1;

  function post<T extends PageEventType>(type: T, payload: PageEventPayloads[T]): void {
    window.postMessage({ source: PAGE_MSG_SOURCE, type, payload }, "*");
  }

  /**
   * Le slug est lu dans l'URL courante et jamais dans le corps de la requête :
   * une soumission porte toujours sur le problème affiché.
   */
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

  function announceVerdict(descriptor: SubmitDescriptor, text: string): void {
    const verdict = verdictFromResponse(text);
    if (verdict === null) {
      console.warn(`${LOG_PREFIX} réponse de soumission sans verdict exploitable`);
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

  type MarkedFunction = { __nccfsrsPatched?: boolean };

  function isAlreadyPatched(value: unknown): boolean {
    return typeof value === "function" && (value as MarkedFunction).__nccfsrsPatched === true;
  }

  function markPatched<T>(fn: T): T {
    Object.defineProperty(fn as object, "__nccfsrsPatched", { value: true });
    return fn;
  }

  // --- fetch ---------------------------------------------------------------
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
        .then((res) => {
          void res
            .clone()
            .text()
            .then((text) => announceVerdict(descriptor, text))
            .catch(() => {});
        })
        .catch(() => {}); // l'appelant garde la promesse d'origine, rejets inclus
      return promise;
    });
  }

  // --- XMLHttpRequest ------------------------------------------------------
  /**
   * Angular configure certaines requêtes en `responseType` non textuel.
   * Accéder à `responseText` lèverait alors une InvalidStateError : on convertit
   * uniquement les réponses déjà identifiées comme pertinentes.
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
    __nccfsrs?: { method: string; url: string };
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
      this.__nccfsrs = { method: String(args[0]), url: String(args[1]) };
      originalOpen.apply(this, args);
    });

    const patchedSend = markPatched(function (
      this: PatchedXhr,
      ...args: Parameters<XMLHttpRequest["send"]>
    ): void {
      const meta = this.__nccfsrs;
      const body = typeof args[0] === "string" ? args[0] : null;
      const descriptor =
        meta === undefined ? null : describeSubmit(meta.method, meta.url, body);
      if (descriptor !== null) {
        announceSubmit(descriptor);
        this.addEventListener(
          "load",
          () => {
            void textFromXhrResponse(this)
              .then((text) => {
                if (text !== null) announceVerdict(descriptor, text);
              })
              .catch((err: unknown) => console.warn(`${LOG_PREFIX} interceptor XHR`, err));
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
    } catch (err) {
      // Ne jamais perdre le repli XHR parce qu'un site a figé fetch.
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

  // --- Navigation SPA ------------------------------------------------------
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

  console.log(`${LOG_PREFIX} interceptor MAIN actif`);
});
