// Pilotage du harnais : boutons manuels + suite de tests automatique.
// Aucun de ces fichiers n'est embarqué dans l'extension.

(() => {
  const results = document.querySelector("[data-results]");
  const slugLabel = document.querySelector("[data-current-slug]");
  let lines = [];
  let failures = 0;

  // Le h1 porte volontairement un suffixe « (DOM) » : si le panneau l'affiche,
  // c'est que le fallback DOM a servi au lieu de l'API de métadonnées.
  const TITLES = {
    "duplicate-integer": ["Contains Duplicate", "Easy"],
    "valid-sudoku": ["Valid Sudoku", "Medium"],
    "sql-playground": ["SQL Playground", "Hard"],
    "probleme-inconnu": ["Problème hors catalogue", "Hard"], // absent de l'API
  };

  function print(line) {
    lines.push(line);
    results.textContent = lines.join("\n");
    results.scrollTop = results.scrollHeight;
  }

  function reset() {
    lines = [];
    failures = 0;
    results.textContent = "";
  }

  function check(ok, label, detail) {
    if (!ok) failures += 1;
    print(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    return ok;
  }

  // --- Simulation de la page NeetCode ---------------------------------------

  function currentSlug() {
    const match = /^\/problems\/([^/]+)/.exec(location.pathname);
    return match ? match[1] : "duplicate-integer";
  }

  function goto(slug) {
    history.pushState({}, "", `/problems/${slug}/question`);
    const [title, difficulty] = TITLES[slug] ?? [slug, "Easy"];
    document.querySelector("h1").textContent = `${title} (DOM)`;
    document.title = `${title} (DOM) - NeetCode`;
    const pill = document.querySelector(".difficulty-pill");
    pill.textContent = difficulty;
    slugLabel.textContent = slug;
  }

  function xhrPost(url, payload) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.responseType = "json"; // comme Angular HttpClient
      xhr.addEventListener("load", () => resolve(xhr.response));
      xhr.addEventListener("error", () => reject(new Error("réseau")));
      xhr.send(JSON.stringify(payload));
    });
  }

  const RAW_CODE =
    "class Solution:\n    def hasDuplicate(self, nums):\n        return len(set(nums)) < len(nums)\n";

  function submitCode(verdict) {
    const query = verdict ? `?verdict=${encodeURIComponent(verdict)}` : "";
    return xhrPost(`/api/executeCodeFunctionHttp${query}`, {
      data: { problemId: currentSlug(), rawCode: RAW_CODE, lang: "python" },
    });
  }

  function runCode() {
    return xhrPost("/api/runCodeFunctionHttp", {
      data: { problemId: currentSlug(), rawCode: RAW_CODE, lang: "python", testCases: [] },
    });
  }

  function sqlCall(runOnly) {
    return xhrPost("/api/runSqlFunctionHttp", {
      data: {
        problemId: currentSlug(),
        rawCode: "SELECT 1;",
        runOnly,
        testCases: [],
      },
    });
  }

  // --- Accès au panneau (Shadow DOM ouvert par le stub) ---------------------

  function panelRoot() {
    return document.getElementById("nccfsrs-panel-host")?.shadowRoot ?? null;
  }

  function bannerRoot() {
    return document.getElementById("nccfsrs-banner-host")?.shadowRoot ?? null;
  }

  function text(root, selector) {
    return root?.querySelector(selector)?.textContent?.trim() ?? null;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(predicate, label, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await predicate(); // accepte un prédicat sync ou async
      if (value) return value;
      await wait(50);
    }
    throw new Error(`délai dépassé : ${label}`);
  }

  async function expectNoPanel(label, delayMs = 500) {
    await wait(delayMs);
    check(panelRoot() === null, label);
  }

  async function store() {
    return self.__harness.store();
  }

  // --- Suite de tests -------------------------------------------------------

  async function autotest() {
    reset();
    print("— Harnais NeetCode Companion —\n");
    goto("duplicate-integer");
    await wait(300); // laisse l'intercepteur s'installer

    print("1. Le bouton « Run » n'est jamais une soumission");
    await runCode();
    await expectNoPanel("aucun panneau après Run");

    print("\n2. Un submit non Accepted ne déclenche rien");
    await submitCode("Wrong Answer");
    await expectNoPanel("aucun panneau après Wrong Answer");

    print("\n3. Un submit Accepted ouvre le panneau");
    await submitCode();
    const panel = await waitFor(panelRoot, "montage du panneau");
    check(
      text(panel, ".title") === "Contains Duplicate",
      "titre résolu via l'API et non via le DOM",
      text(panel, ".title"),
    );
    check(text(panel, ".chip.easy") === "Easy", "difficulté résolue via l'API");
    const chips = [...panel.querySelectorAll(".chip")].map((c) => c.textContent.trim());
    check(
      chips.some((c) => c === "2 soumissions"),
      "soumissions de la session comptées sans le Run",
      chips.join(" | "),
    );

    print("\n4. La prévisualisation d'échéance répond à la sélection");
    panel.querySelector('[data-mode="seul"]').click();
    panel.querySelector('[data-feel="2"]').click();
    const preview = await waitFor(
      () => {
        const value = text(panel, ".next b");
        return value && value !== "—" ? value : null;
      },
      "prévisualisation de l'échéance",
    );
    check(true, "prochaine révision prévisualisée", preview);
    check(
      panel.querySelector(".save").disabled === false,
      "bouton d'enregistrement activé",
    );

    print("\n5. L'enregistrement écrit carte + log");
    panel.querySelector(".save").click();
    const saved = await waitFor(async () => {
      const data = await store();
      return data.cards?.["duplicate-integer"] ? data : null;
    }, "écriture de la carte");
    const card = saved.cards["duplicate-integer"];
    check(card.title === "Contains Duplicate", "titre de la carte", card.title);
    check(card.ncDifficulty === "Easy", "difficulté de la carte");
    check(card.lastMode === "seul" && card.lastFeel === 2, "mode et ressenti enregistrés");
    check(saved.log.length === 1, "une entrée de log", String(saved.log.length));
    check(saved.log[0].grade === 3, "ressenti 2 → grade Good (3)", String(saved.log[0].grade));
    check(
      new Date(card.fsrs.due).getTime() > Date.now(),
      "échéance dans le futur",
      card.fsrs.due,
    );
    check(saved.log[0].scheduledDue === card.fsrs.due, "log et carte cohérents");
    await waitFor(() => panelRoot() === null, "démontage du panneau après enregistrement", 4000);
    check(true, "le panneau se retire après enregistrement");

    print("\n6. La fenêtre anti-doublon ignore un Accepted immédiat");
    await submitCode();
    await expectNoPanel("aucun panneau pendant le cooldown", 700);

    print("\n7. Fermer sans noter conserve l'Accepted en attente");
    goto("valid-sudoku");
    await wait(150);
    await submitCode();
    const panel2 = await waitFor(panelRoot, "panneau pour Valid Sudoku");
    check(text(panel2, ".title") === "Valid Sudoku", "titre du second problème");
    check(text(panel2, ".chip.medium") === "Medium", "difficulté Medium");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const pending = await waitFor(async () => {
      const data = await store();
      return data.pendingAccepted ?? null;
    }, "écriture de pendingAccepted");
    check(pending.slug === "valid-sudoku", "pendingAccepted pointe le bon problème");
    check(panelRoot() === null, "panneau fermé par Échap");

    print("\n8. SQL : « Run » ignoré, « Submit » pris en compte");
    goto("sql-playground");
    await wait(150);
    await sqlCall(true);
    await expectNoPanel("aucun panneau après un SQL Run (runOnly: true)");
    await sqlCall(false);
    const panel3 = await waitFor(panelRoot, "panneau après un SQL Submit");
    check(text(panel3, ".title") === "SQL Playground", "titre du problème SQL");
    panel3.querySelector(".close").click();

    print("\n9. Sans métadonnées API, le panneau retombe sur le DOM");
    goto("probleme-inconnu");
    await wait(150);
    await submitCode();
    const panel4 = await waitFor(panelRoot, "panneau pour un problème hors catalogue");
    check(
      text(panel4, ".title") === "Problème hors catalogue (DOM)",
      "titre repris du h1 de la page",
      text(panel4, ".title"),
    );
    check(text(panel4, ".chip.hard") === "Hard", "difficulté reprise de la pastille");
    panel4.querySelector(".close").click();
    await waitFor(() => panelRoot() === null, "fermeture du panneau");

    print("\n10. Le bandeau annonce les révisions dues");
    const nowIso = new Date(Date.now() - 60_000).toISOString();
    const data = await store();
    data.cards["duplicate-integer"].fsrs.due = nowIso;
    await self.browser.storage.local.set({ cards: data.cards });
    // Le badge n'est recalculé que par le background : on le réveille comme le
    // ferait une alarme, via un message qui déclenche updateBadge().
    await self.browser.runtime.sendMessage({ kind: "SAVE_SETTINGS", settings: {} });
    const banner = await waitFor(bannerRoot, "affichage du bandeau");
    check(
      (text(banner, ".txt") ?? "").includes("Contains Duplicate"),
      "le bandeau nomme la révision la plus ancienne",
      text(banner, ".txt"),
    );
    check(self.__harness.badgeText() === "1", "badge à 1", self.__harness.badgeText());
    banner.querySelector(".later").click();
    await waitFor(() => bannerRoot() === null, "bandeau reporté");
    check(true, "« Plus tard » retire le bandeau");

    print(
      `\n${failures === 0 ? "TOUS LES TESTS PASSENT" : `${failures} ÉCHEC(S)`} · ${lines.filter((l) => l.startsWith("✓") || l.startsWith("✗")).length} assertions`,
    );
    self.__harnessDone = { failures };
  }

  // --- Boutons --------------------------------------------------------------

  document.querySelectorAll("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => {
      goto(button.getAttribute("data-goto"));
      print(`→ ${button.getAttribute("data-goto")}`);
    });
  });

  const ACTIONS = {
    run: () => runCode().then(() => print("Run envoyé")),
    "submit-accepted": () => submitCode().then(() => print("Submit Accepted envoyé")),
    "submit-wrong": () => submitCode("Wrong Answer").then(() => print("Submit Wrong Answer envoyé")),
    "sql-run": () => sqlCall(true).then(() => print("SQL Run envoyé")),
    "sql-submit": () => sqlCall(false).then(() => print("SQL Submit envoyé")),
    autotest,
    reset: async () => {
      self.__harness.resetStore();
      print("Stockage vidé — recharge la page");
    },
    dump: async () => print(JSON.stringify(await store(), null, 2)),
  };

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = ACTIONS[button.getAttribute("data-action")];
      if (action) {
        Promise.resolve(action()).catch((err) => print(`✗ ${err.message}`));
      }
    });
  });

  slugLabel.textContent = currentSlug();

  if (new URLSearchParams(location.search).get("autotest") === "1") {
    autotest().catch((err) => {
      print(`✗ ${err.message}`);
      self.__harnessDone = { failures: failures + 1 };
    });
  }
})();
