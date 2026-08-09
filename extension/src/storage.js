// Accès à browser.storage.local. Les MUTATIONS ne doivent être appelées que
// depuis le background (single-writer) ; les lectures sont libres (popup,
// bandeau, options).

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;
  const browser = NCC.browser;

  NCC.SCHEMA_VERSION = 1;

  NCC.DEFAULT_SETTINGS = {
    reviewCooldownHours: 8,
    requestRetention: 0.9,
    maximumIntervalDays: 180,
    arracheCountsAsAgain: false,
    bannerSnoozedUntil: null,
  };

  async function read(key) {
    const res = await browser.storage.local.get(key);
    return res[key];
  }

  NCC.getSettings = async function getSettings() {
    return { ...NCC.DEFAULT_SETTINGS, ...(await read("settings")) };
  };

  NCC.getCards = async function getCards() {
    return (await read("cards")) ?? {};
  };

  NCC.getLog = async function getLog() {
    return (await read("log")) ?? [];
  };

  NCC.getPendingAccepted = async function getPendingAccepted() {
    return (await read("pendingAccepted")) ?? null;
  };

  /** Snapshot complet — export JSON. */
  NCC.getAllData = async function getAllData() {
    const [cards, log, settings, pendingAccepted] = await Promise.all([
      NCC.getCards(),
      NCC.getLog(),
      NCC.getSettings(),
      NCC.getPendingAccepted(),
    ]);
    return { schemaVersion: NCC.SCHEMA_VERSION, cards, log, settings, pendingAccepted };
  };

  // --- Mutations (background uniquement) ------------------------------------

  /**
   * Écrit une carte ET son entrée de log en un seul set() : jamais l'un sans
   * l'autre — le log est la source de vérité.
   */
  NCC.saveReview = async function saveReview(card, entry) {
    const [cards, log] = await Promise.all([NCC.getCards(), NCC.getLog()]);
    cards[card.slug] = card;
    log.push(entry);
    await browser.storage.local.set({ cards, log });
  };

  /** Répare les métadonnées d'une carte marquée metaIncomplete. */
  NCC.updateCardMeta = async function updateCardMeta(slug, meta) {
    const cards = await NCC.getCards();
    const card = cards[slug];
    if (card === undefined) return;
    const { metaIncomplete: _dropped, ...rest } = card;
    cards[slug] = { ...rest, ...meta, updatedAt: new Date().toISOString() };
    await browser.storage.local.set({ cards });
  };

  NCC.setPendingAccepted = async function setPendingAccepted(pending) {
    await browser.storage.local.set({ pendingAccepted: pending });
  };

  NCC.setSettings = async function setSettings(settings) {
    await browser.storage.local.set({ settings });
  };

  /** Init/migration du schéma au démarrage du background. */
  NCC.migrateIfNeeded = async function migrateIfNeeded() {
    const version = (await read("schemaVersion")) ?? 0;
    if (version === NCC.SCHEMA_VERSION) return;
    if (version === 0) {
      await browser.storage.local.set({
        schemaVersion: NCC.SCHEMA_VERSION,
        cards: (await read("cards")) ?? {},
        log: (await read("log")) ?? [],
        settings: await NCC.getSettings(),
        pendingAccepted: (await read("pendingAccepted")) ?? null,
      });
      return;
    }
    // Versions futures : migrations explicites ici.
    throw new Error(`schemaVersion inconnue: ${version}`);
  };
})();
