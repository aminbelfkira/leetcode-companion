// Harnais uniquement : stub des API d'extension + hook d'ouverture des Shadow
// DOM. Chargé AVANT tout fichier de extension/ et jamais embarqué dans le build.

(() => {
  const params = new URLSearchParams(location.search);
  const STORAGE_KEY = "nccfsrs-harness-store";

  if (params.get("autotest") === "1" || params.get("reset") === "1") {
    localStorage.removeItem(STORAGE_KEY);
  }

  // --- Shadow DOM ouvert ----------------------------------------------------
  // Le panneau et le bandeau utilisent `mode: "closed"` en production ; le
  // harnais force `open` pour pouvoir inspecter et cliquer leur contenu.
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return originalAttachShadow.call(this, { ...init, mode: "open" });
  };

  // --- storage.local --------------------------------------------------------
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function persist(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  const changeListeners = [];
  const messageListeners = [];

  const storageLocal = {
    async get(key) {
      const store = load();
      if (typeof key === "string") {
        return key in store ? { [key]: store[key] } : {};
      }
      return { ...store };
    },
    async set(values) {
      const store = load();
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: store[key], newValue: value };
        store[key] = value;
      }
      persist(store);
      for (const listener of changeListeners) listener(changes, "local");
    },
  };

  let badgeText = "";

  self.browser = {
    runtime: {
      getURL: (path) => `/extension/${String(path).replace(/^\//, "")}`,
      sendMessage(message) {
        return new Promise((resolve) => {
          for (const listener of messageListeners) {
            let settled = false;
            const sendResponse = (response) => {
              if (settled) return;
              settled = true;
              resolve(response);
            };
            if (listener(message, { id: "harness" }, sendResponse) === true) return;
            if (settled) return;
          }
          resolve({ error: "aucun listener" });
        });
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      openOptionsPage: () => window.open("/extension/options/index.html", "_blank"),
    },
    storage: {
      local: storageLocal,
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} },
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText({ text }) {
        badgeText = text;
        const el = document.querySelector("[data-badge]");
        if (el) el.textContent = text === "" ? "—" : text;
      },
    },
    tabs: {
      async query() {
        return [{ url: location.href }];
      },
      async create({ url }) {
        window.open(url, "_blank");
      },
    },
  };

  self.__harness = {
    badgeText: () => badgeText,
    store: load,
    resetStore() {
      localStorage.removeItem(STORAGE_KEY);
    },
  };
})();
