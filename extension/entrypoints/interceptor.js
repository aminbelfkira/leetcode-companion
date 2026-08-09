// Monde MAIN : patch fetch + XHR + history, relaie les événements utiles au
// content script ISOLATED via window.postMessage.
//
// Ce fichier est injecté dans la page par entrypoints/content.js et ne partage
// donc AUCUN global avec le reste de l'extension : il est volontairement
// autonome. Les constantes d'endpoints sont dupliquées depuis src/nc-endpoints.js.
//
// Aucune écriture storage ici. Le code source de l'utilisateur (`rawCode`)
// n'est jamais lu, ni journalisé, ni transmis.

(() => {
  const PAGE_MSG_SOURCE = "nccfsrs";
  const LOG_PREFIX = "[nccfsrs]";

  /** Submit d'un problème de code → un seul aller-retour, verdict compris. */
  const SUBMIT_PATH = "/api/executeCodeFunctionHttp";
  /** Submit ET Run d'un problème SQL : `runOnly` les départage. */
  const SQL_PATH = "/api/runSqlFunctionHttp";
  /** Bouton « Run » d'un problème de code : jamais interprété comme un submit. */
  const RUN_PATH = "/api/runCodeFunctionHttp";

  /** Au-delà, on ne tente pas de lire le corps : il ne contient que du code. */
  const MAX_BODY_BYTES = 4_000_000;

  let nextToken = 1;

  function post(type, payload) {
    window.postMessage({ source: PAGE_MSG_SOURCE, type, payload }, "*");
  }

  function pathnameFor(url) {
    try {
      return new URL(url, location.origin).pathname;
    } catch {
      return null;
    }
  }

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Lit uniquement le drapeau `runOnly` d'un submit SQL. Le corps parsé n'est
   * ni conservé ni journalisé ; seul un booléen en sort.
   */
  function sqlIsSubmit(body) {
    if (typeof body !== "string" || body.length > MAX_BODY_BYTES) return false;
    const parsed = safeJson(body);
    const runOnly = parsed && parsed.data ? parsed.data.runOnly : undefined;
    return runOnly === false;
  }

  /**
   * `null` si la requête n'est pas un submit. Sinon un descripteur minimal :
   * le slug est lu dans l'URL courante, jamais dans le corps de la requête.
   */
  function submitDescriptor(method, url, body) {
    if (method !== "POST") return null;
    const pathname = pathnameFor(url);
    if (pathname === null) return null;
    if (pathname === RUN_PATH) return null;
    if (pathname !== SUBMIT_PATH && pathname !== SQL_PATH) return null;
    if (pathname === SQL_PATH && !sqlIsSubmit(body)) return null;
    return { token: String(nextToken++), slug: slugFromPathname(location.pathname) };
  }

  function slugFromPathname(pathname) {
    const match = /^\/problems\/([^/]+)(?:\/|$)/.exec(pathname);
    return match ? match[1] : null;
  }

  /** Le verdict vit dans `{ data: { status: { description } } }`. */
  function verdictFromResponse(text) {
    const json = safeJson(text);
    const data = json && typeof json === "object" ? json.data : null;
    const status = data && typeof data === "object" ? data.status : null;
    const description =
      status && typeof status === "object" && typeof status.description === "string"
        ? status.description
        : null;
    if (description === null) return null;
    const testCaseCount = numberOrNull(data.test_case_count);
    const correctTestCaseCount = numberOrNull(data.correct_test_case_count);
    return { statusDescription: description, testCaseCount, correctTestCaseCount };
  }

  function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function announceSubmit(descriptor) {
    post("submission-created", { token: descriptor.token, slug: descriptor.slug });
  }

  function announceVerdict(descriptor, text) {
    const verdict = verdictFromResponse(text);
    if (verdict === null) {
      console.warn(`${LOG_PREFIX} réponse de submit sans verdict exploitable`);
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

  function isAlreadyPatched(value) {
    return typeof value === "function" && value.__nccfsrsPatched === true;
  }

  function markPatched(fn) {
    Object.defineProperty(fn, "__nccfsrsPatched", { value: true });
    return fn;
  }

  // --- fetch ----------------------------------------------------------------
  function installFetchInterceptor() {
    if (isAlreadyPatched(window.fetch)) return;
    const originalFetch = window.fetch;
    window.fetch = markPatched(function (input, init) {
      const url = input instanceof Request ? input.url : String(input);
      const method = (
        (init && init.method) || (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const body = init && typeof init.body === "string" ? init.body : null;
      const descriptor = submitDescriptor(method, url, body);
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

  // --- XMLHttpRequest -------------------------------------------------------
  /**
   * Angular (HttpClient sans withFetch) passe par XHR : c'est ce chemin qui
   * porte réellement les submits NeetCode.
   */
  function textFromXhrResponse(xhr) {
    switch (xhr.responseType) {
      case "":
      case "text":
        return Promise.resolve(xhr.responseText);
      case "json":
        return Promise.resolve(xhr.response === null ? null : JSON.stringify(xhr.response));
      case "blob":
        return xhr.response instanceof Blob ? xhr.response.text() : Promise.resolve(null);
      case "arraybuffer":
        return Promise.resolve(
          xhr.response instanceof ArrayBuffer
            ? new TextDecoder().decode(xhr.response)
            : null,
        );
      default:
        return Promise.resolve(null);
    }
  }

  function installXhrInterceptor() {
    const proto = XMLHttpRequest.prototype;
    if (isAlreadyPatched(proto.open) && isAlreadyPatched(proto.send)) return;

    const originalOpen = proto.open;
    const originalSend = proto.send;

    proto.open = markPatched(function (...args) {
      this.__nccfsrs = { method: String(args[0]).toUpperCase(), url: String(args[1]) };
      return originalOpen.apply(this, args);
    });

    proto.send = markPatched(function (...args) {
      const meta = this.__nccfsrs;
      const body = typeof args[0] === "string" ? args[0] : null;
      const descriptor =
        meta === undefined ? null : submitDescriptor(meta.method, meta.url, body);
      if (descriptor !== null) {
        announceSubmit(descriptor);
        this.addEventListener(
          "load",
          () => {
            textFromXhrResponse(this)
              .then((text) => {
                if (text !== null) announceVerdict(descriptor, text);
              })
              .catch((err) => console.warn(`${LOG_PREFIX} interceptor XHR`, err));
          },
          { once: true },
        );
      }
      return originalSend.apply(this, args);
    });
  }

  function installNetworkInterceptors() {
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

  // --- Navigation SPA -------------------------------------------------------
  function emitUrlChange() {
    post("url-change", { pathname: location.pathname, search: location.search });
  }

  const originalPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    originalPushState(...args);
    emitUrlChange();
  };
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    originalReplaceState(...args);
    emitUrlChange();
  };
  window.addEventListener("popstate", emitUrlChange);

  console.log(`${LOG_PREFIX} interceptor MAIN actif`);
})();
