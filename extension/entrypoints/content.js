// Monde ISOLATED : injecte l'intercepteur dans la page, consomme ses événements,
// gère la session par problème, monte le panneau de notation sur Accepted.

(() => {
  const NCC = self.NCC;
  const {
    LOG_PREFIX,
    PAGE_MSG_SOURCE,
    SESSION_MAX_AGE_H,
    browser,
    isAcceptedVerdict,
    listSlugFromSearch,
    problemSlugFromPathname,
    resolveMeta,
    reviewProblemUrl,
    sendToBackground,
  } = NCC;

  // --- Injection du monde MAIN ----------------------------------------------

  /**
   * Le patch de XMLHttpRequest doit vivre dans le contexte de la page : un
   * content script a son propre XMLHttpRequest et ne verrait rien.
   */
  function injectInterceptor() {
    try {
      const script = document.createElement("script");
      script.src = browser.runtime.getURL("entrypoints/interceptor.js");
      script.async = false;
      script.addEventListener("load", () => script.remove(), { once: true });
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      console.warn(`${LOG_PREFIX} injection interceptor`, err);
    }
  }

  injectInterceptor();

  // --- Session par problème -------------------------------------------------

  let session = null;

  /** Contexte de liste (?list=neetcode150) mémorisé au lancement du submit. */
  const submissionLists = new Map();
  const MAX_SUBMISSION_CONTEXTS = 128;

  function rememberSubmissionList(token) {
    submissionLists.set(token, listSlugFromSearch(location.search));
    while (submissionLists.size > MAX_SUBMISSION_CONTEXTS) {
      const oldest = submissionLists.keys().next().value;
      if (oldest === undefined) break;
      submissionLists.delete(oldest);
    }
  }

  function takeSubmissionList(token) {
    const value = submissionLists.has(token)
      ? (submissionLists.get(token) ?? null)
      : listSlugFromSearch(location.search);
    submissionLists.delete(token);
    return value;
  }

  function ensureSession(slug) {
    const now = Date.now();
    const stale =
      session !== null && now - session.startedAt > SESSION_MAX_AGE_H * 3_600_000;
    if (session === null || session.slug !== slug || stale) {
      session = { slug, startedAt: now, submitCount: 0 };
      console.log(`${LOG_PREFIX} nouvelle session`, { slug, stale });
      void maybeRepairMeta(slug).catch((err) =>
        console.warn(`${LOG_PREFIX} repairMeta`, err),
      );
    }
    return session;
  }

  /** Carte metaIncomplete : nouvelle tentative à la visite du problème. */
  const metaRepairTried = new Set();
  async function maybeRepairMeta(slug) {
    if (metaRepairTried.has(slug)) return;
    metaRepairTried.add(slug);
    const cards = await NCC.getCards();
    if (cards[slug]?.metaIncomplete !== true) return;
    const meta = await resolveMeta(slug);
    if (meta.metaIncomplete) return; // toujours en échec, on retentera plus tard
    await sendToBackground({
      kind: "UPDATE_CARD_META",
      slug,
      title: meta.title,
      ncDifficulty: meta.ncDifficulty,
    });
    console.log(`${LOG_PREFIX} métadonnées réparées`, slug);
  }

  // --- Événements du monde MAIN ---------------------------------------------

  function onMessage(event) {
    try {
      onMessageUnsafe(event);
    } catch (err) {
      console.warn(`${LOG_PREFIX} onMessage`, err); // jamais de crash visible
    }
  }

  function onMessageUnsafe(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (typeof data !== "object" || data === null || data.source !== PAGE_MSG_SOURCE) {
      return;
    }

    switch (data.type) {
      case "url-change": {
        const slug = problemSlugFromPathname(data.payload.pathname);
        // Hors /problems/* : on conserve la session (retour possible au même slug).
        if (slug !== null) ensureSession(slug);
        break;
      }
      case "submission-created": {
        const slug = data.payload.slug ?? problemSlugFromPathname(location.pathname);
        if (slug === null) break;
        const current = ensureSession(slug);
        current.submitCount += 1;
        rememberSubmissionList(data.payload.token);
        console.log(`${LOG_PREFIX} soumission créée`, {
          token: data.payload.token,
          slug: current.slug,
          submitCount: current.submitCount,
        });
        break;
      }
      case "submission-result": {
        const { token, statusDescription } = data.payload;
        console.log(`${LOG_PREFIX} submission-result`, { token, statusDescription });
        const listSlug = takeSubmissionList(token);
        if (!isAcceptedVerdict(statusDescription) || session === null) break;
        const minutes = Math.round((Date.now() - session.startedAt) / 60_000);
        const snapshot = {
          slug: data.payload.slug ?? session.slug,
          listSlug,
          submissionsInSession: session.submitCount,
          minutesInSession: minutes,
        };
        console.log(`${LOG_PREFIX} ✓ Accepted détecté`, snapshot);
        handleAccepted(snapshot).catch((err) =>
          console.warn(`${LOG_PREFIX} handleAccepted`, err),
        );
        break;
      }
    }
  }

  /** Métadonnées, cooldown, panneau de notation. */
  async function handleAccepted(snapshot) {
    if (NCC.isPanelMounted()) return;

    const { underCooldown } = await sendToBackground({
      kind: "CHECK_COOLDOWN",
      slug: snapshot.slug,
    });
    if (underCooldown) {
      console.log(`${LOG_PREFIX} Accepted ignoré (cooldown)`, snapshot.slug);
      return;
    }

    const meta = await resolveMeta(snapshot.slug);
    const acceptedAt = new Date().toISOString();

    NCC.mountPanel(
      {
        title: meta.title,
        ncDifficulty: meta.ncDifficulty,
        submissionsInSession: snapshot.submissionsInSession,
        minutesInSession: snapshot.minutesInSession,
      },
      {
        previewDue: async (mode, feel) => {
          const { scheduledDue } = await sendToBackground({
            kind: "PREVIEW_REVIEW",
            slug: snapshot.slug,
            mode,
            feel,
          });
          return scheduledDue;
        },
        onSave: async (mode, feel) => {
          try {
            const { scheduledDue } = await sendToBackground({
              kind: "LOG_REVIEW",
              review: {
                slug: snapshot.slug,
                title: meta.title,
                ncDifficulty: meta.ncDifficulty,
                listSlug: snapshot.listSlug,
                metaIncomplete: meta.metaIncomplete,
                mode,
                feel,
                submissionsInSession: snapshot.submissionsInSession,
                minutesInSession: snapshot.minutesInSession,
              },
            });
            return scheduledDue;
          } catch (err) {
            console.warn(`${LOG_PREFIX} LOG_REVIEW`, err);
            return null;
          }
        },
        onDismiss: () => {
          void sendToBackground({
            kind: "SET_PENDING_ACCEPTED",
            pending: {
              slug: snapshot.slug,
              title: meta.title,
              ncDifficulty: meta.ncDifficulty,
              listSlug: snapshot.listSlug,
              submissionsInSession: snapshot.submissionsInSession,
              minutesInSession: snapshot.minutesInSession,
              acceptedAt,
            },
          }).catch((err) => console.warn(`${LOG_PREFIX} pendingAccepted`, err));
        },
      },
    );
  }

  // --- Bandeau --------------------------------------------------------------

  /** Affiche/retire le bandeau selon dus + snooze ; rappelé sur storage.onChanged. */
  async function refreshBanner() {
    try {
      const [cards, settings] = await Promise.all([NCC.getCards(), NCC.getSettings()]);
      const now = Date.now();
      const snoozed =
        settings.bannerSnoozedUntil !== null &&
        new Date(settings.bannerSnoozedUntil).getTime() > now;
      const due = Object.values(cards)
        .filter((card) => new Date(card.fsrs.due).getTime() <= now)
        .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due));
      const oldest = due[0];
      if (snoozed || oldest === undefined) {
        NCC.removeBanner();
        return;
      }
      NCC.renderBanner(
        { count: due.length, next: { slug: oldest.slug, title: oldest.title } },
        {
          onOpen: (slug) => location.assign(reviewProblemUrl(slug)),
          onSnooze: () => {
            void sendToBackground({ kind: "SNOOZE_BANNER" }).catch((err) =>
              console.warn(`${LOG_PREFIX} snooze`, err),
            );
          },
        },
      );
    } catch (err) {
      console.warn(`${LOG_PREFIX} bandeau`, err);
    }
  }

  // Mise à jour live inter-onglets : reviews, snooze, etc.
  browser.storage.onChanged.addListener(() => {
    void refreshBanner();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void refreshBanner(), { once: true });
  } else {
    void refreshBanner();
  }

  window.addEventListener("message", onMessage);

  const initialSlug = problemSlugFromPathname(location.pathname);
  if (initialSlug !== null) ensureSession(initialSlug);

  console.log(`${LOG_PREFIX} content ISOLATED actif`);
})();
