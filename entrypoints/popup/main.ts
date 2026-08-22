// Popup « Focus du jour ». Lectures directes du storage, mutations via messages
// au background (single-writer).

import { browser } from "wxt/browser";
import { LOG_PREFIX } from "../../src/config";
import { formatDueRelative } from "../../src/fsrs";
import { LC_ORIGIN, problemSlugFromPathname as lcProblemSlug } from "../../src/lc-endpoints";
import { sendToBackground } from "../../src/messaging";
import { NC_ORIGIN, problemSlugFromPathname as ncProblemSlug } from "../../src/nc-endpoints";
import { problemUrl } from "../../src/problem-identity";
import { dueCards } from "../../src/review";
import { getAllData } from "../../src/storage";
import type {
  Feel,
  Mode,
  PendingAccepted,
  Platform,
  ProblemCard,
  ProblemDescriptor,
  ReviewInput,
} from "../../src/types";

const app = document.querySelector<HTMLDivElement>("#app");

const DAY_MS = 86_400_000;
const EXTENSION_ICON_URL = browser.runtime.getURL("/icon/32.png");

const ICONS = {
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>`,
  chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>`,
  export: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.95 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.24.62.85 1.02 1.52 1.02H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg>`,
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function midnight(date: Date): number {
  const m = new Date(date);
  m.setHours(0, 0, 0, 0);
  return m.getTime();
}

function modeLabel(mode: Mode): string {
  switch (mode) {
    case "seul":
      return "seul";
    case "aide":
      return "aidé";
    case "abandon":
      return "abandonné";
  }
}

function cardMetaHtml(card: ProblemCard): string {
  const difficulty = card.difficulty.toLowerCase();
  const feel = card.lastFeel === null ? "ressenti non noté" : `ressenti ${card.lastFeel}`;
  const platforms = Object.keys(card.sources)
    .map((platform) => (platform === "leetcode" ? "LeetCode" : "NeetCode"))
    .join(" + ");
  return `
    <span class="difficulty difficulty-${difficulty}">${esc(card.difficulty)}</span>
    <span>${esc(platforms)}</span>
    <span>${esc(modeLabel(card.lastMode))}</span>
    <span>${esc(feel)}</span>
  `;
}

function dueBadgeHtml(card: ProblemCard, todayMid: number): string {
  const lateDays = Math.round((todayMid - midnight(new Date(card.fsrs.due))) / DAY_MS);
  return lateDays > 0
    ? `<span class="due-badge late">${lateDays} j de retard</span>`
    : `<span class="due-badge today">Aujourd'hui</span>`;
}

function reviewRowHtml(card: ProblemCard, todayMid: number): string {
  return `
    <button class="review-row" data-open="${esc(card.id)}">
      <span class="review-copy">
        <span class="review-name">${esc(card.title)}</span>
        <span class="review-meta">${esc(card.difficulty)} · ${esc(modeLabel(card.lastMode))} · ${
          card.lastFeel === null ? "non noté" : `ressenti ${card.lastFeel}`
        }</span>
      </span>
      ${dueBadgeHtml(card, todayMid)}
      <span class="row-chevron">${ICONS.chevron}</span>
    </button>
  `;
}

async function activeTrackedId(cards: Record<string, ProblemCard>): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const url = new URL(tab.url);
    const platform: Platform | null =
      url.origin === NC_ORIGIN ? "neetcode" : url.origin === LC_ORIGIN ? "leetcode" : null;
    if (platform === null) return null;
    const slug = platform === "neetcode" ? ncProblemSlug(url.pathname) : lcProblemSlug(url.pathname);
    if (slug === null) return null;
    return Object.values(cards).find((card) => card.sources[platform]?.slug === slug)?.id ?? null;
  } catch {
    return null;
  }
}

let pendingMode: Extract<Mode, "seul" | "aide"> | null = null;
let pendingFeel: Feel | null = null;

async function render(): Promise<void> {
  if (!app) return;
  pendingMode = null;
  pendingFeel = null;

  const data = await getAllData();
  const now = new Date();
  const nowMs = now.getTime();
  const todayMid = midnight(now);
  const tomorrowMid = todayMid + DAY_MS;
  const afterTomorrowMid = tomorrowMid + DAY_MS;
  const weekEnd = todayMid + 7 * DAY_MS;

  const all = Object.values(data.cards);
  const due = dueCards(data.cards, nowMs);
  const next = all
    .filter((card) => new Date(card.fsrs.due).getTime() > nowMs)
    .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due))[0];
  const dueTomorrow = all.filter((card) => {
    const t = new Date(card.fsrs.due).getTime();
    return t > nowMs && t >= tomorrowMid && t < afterTomorrowMid;
  }).length;
  const dueThisWeek = all.filter((card) => {
    const t = new Date(card.fsrs.due).getTime();
    return t > nowMs && t >= afterTomorrowMid && t < weekEnd;
  }).length;

  const dateLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const activeId = await activeTrackedId(data.cards);

  const parts: string[] = [];
  parts.push(`
    <header class="topbar">
      <div class="brand">
        <img src="${esc(EXTENSION_ICON_URL)}" alt="" width="32" height="32" />
        <div class="brand-copy">
          <div class="brand-name">Companion</div>
          <div class="date">${esc(dateLabel)}</div>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-button" data-export aria-label="Exporter les données" title="Exporter les données">
          ${ICONS.export}
        </button>
        <button class="icon-button" data-options aria-label="Ouvrir les réglages" title="Réglages">
          ${ICONS.settings}
        </button>
      </div>
    </header>
  `);

  if (data.pendingAccepted !== null) {
    parts.push(pendingBlockHtml(data.pendingAccepted));
  } else {
    parts.push(focusBlockHtml(due, next, now, activeId));
    const queue = queueBlockHtml(due, dueTomorrow, dueThisWeek, todayMid);
    if (queue !== "") parts.push(queue);
    if (activeId !== null && due.some((card) => card.id === activeId)) {
      parts.push(`
        <button class="defer-action" data-abandon="${esc(activeId)}">
          Je bloque sur cette révision · la revoir demain
        </button>
      `);
    }
  }

  app.innerHTML = parts.join("");
  wire(data.cards, data.pendingAccepted);
}

function focusBlockHtml(
  due: ProblemCard[],
  next: ProblemCard | undefined,
  now: Date,
  activeId: string | null,
): string {
  const focus = due[0];
  if (focus === undefined) {
    const nextCopy =
      next === undefined
        ? "Résous un problème pour démarrer ton planning de révision."
        : `${esc(next.title)} · ${esc(formatDueRelative(next.fsrs.due, now))}`;
    return `
      <main class="focus-card focus-clear" aria-labelledby="focus-title">
        <div class="success-icon">${ICONS.check}</div>
        <div class="eyebrow">FOCUS DU JOUR</div>
        <h1 id="focus-title">Tout est à jour</h1>
        <p class="focus-description">${nextCopy}</p>
      </main>
    `;
  }

  const count = due.length;
  const verb = activeId === focus.id ? "Reprendre" : "Commencer";
  return `
    <main class="focus-card" aria-labelledby="focus-title">
      <div class="eyebrow">FOCUS DU JOUR</div>
      <h1 id="focus-title">${count} révision${count > 1 ? "s" : ""}</h1>
      <div class="focus-meta">${cardMetaHtml(focus)}</div>
      <button class="primary-action" data-open="${esc(focus.id)}" aria-label="Réviser ${esc(focus.title)}">
        <span>${verb} avec ${esc(focus.title)}</span>
        ${ICONS.arrow}
      </button>
    </main>
  `;
}

function queueBlockHtml(
  due: ProblemCard[],
  dueTomorrow: number,
  dueThisWeek: number,
  todayMid: number,
): string {
  const items = due.slice(1, 3);
  const hidden = Math.max(0, due.length - 1 - items.length);
  const schedule: string[] = [];
  if (dueTomorrow > 0) schedule.push(`demain · ${dueTomorrow}`);
  if (dueThisWeek > 0) schedule.push(`cette semaine · ${dueThisWeek}`);
  if (items.length === 0) return "";

  return `
    <section class="queue" aria-labelledby="queue-title">
      <div class="section-heading">
        <h2 id="queue-title">Ensuite</h2>
        ${schedule.length > 0 ? `<span>${schedule.join(" · ")}</span>` : ""}
      </div>
      ${items.map((card) => reviewRowHtml(card, todayMid)).join("")}
      ${
        hidden > 0
          ? `<div class="queue-more">+${hidden} autre${hidden > 1 ? "s" : ""} à réviser aujourd'hui</div>`
          : ""
      }
    </section>
  `;
}

// --- Bloc « Noter le dernier Accepted » ------------------------------------

function pendingBlockHtml(pending: PendingAccepted): string {
  const difficulty = pending.problem.difficulty.toLowerCase();
  return `
    <main class="focus-card pending-card" id="pending" aria-labelledby="pending-title">
      <div class="eyebrow">ACTION REQUISE</div>
      <h1 id="pending-title">Noter le dernier Accepted</h1>
      <div class="pending-problem">
        <span>${esc(pending.problem.title)}</span>
        <span class="difficulty difficulty-${difficulty}">${esc(pending.problem.difficulty)}</span>
      </div>
      <div class="field-label">Résolution</div>
      <div class="rate-row" data-group="mode">
        <button class="opt" data-mode="seul" aria-pressed="false">Seul</button>
        <button class="opt" data-mode="aide" aria-pressed="false">Avec aide<small>IA · YouTube · solution</small></button>
      </div>
      <div class="field-label">Ressenti</div>
      <div class="rate-row" data-group="feel">
        <button class="opt" data-feel="1" aria-pressed="false">1<small>fluide</small></button>
        <button class="opt" data-feel="2" aria-pressed="false">2<small>correct</small></button>
        <button class="opt" data-feel="3" aria-pressed="false">3<small>laborieux</small></button>
        <button class="opt" data-feel="4" aria-pressed="false">4<small>à l'arraché</small></button>
      </div>
      <div class="next-line">Prochaine révision : <b>—</b></div>
      <button class="primary-action" data-save-pending disabled>
        <span>Enregistrer la révision</span>
        ${ICONS.arrow}
      </button>
    </main>
  `;
}

async function refreshPendingPreview(pending: PendingAccepted): Promise<void> {
  const nextEl = document.querySelector<HTMLElement>("#pending .next-line b");
  const saveBtn = document.querySelector<HTMLButtonElement>("[data-save-pending]");
  if (pendingMode === null || pendingFeel === null || !nextEl || !saveBtn) return;
  saveBtn.disabled = false;
  try {
    const { scheduledDue } = await sendToBackground({
      kind: "PREVIEW_REVIEW",
      problemId: pending.problemId,
      mode: pendingMode,
      feel: pendingFeel,
    });
    nextEl.textContent = formatDueRelative(scheduledDue);
  } catch {
    nextEl.textContent = "—";
  }
}

function reviewFromPending(pending: PendingAccepted, mode: Mode, feel: Feel): ReviewInput {
  return {
    problemId: pending.problemId,
    problem: pending.problem,
    mode,
    feel,
    submissionsInSession: pending.submissionsInSession,
    minutesInSession: pending.minutesInSession,
  };
}

function descriptorFromCard(card: ProblemCard): ProblemDescriptor {
  const platform: Platform = card.sources.leetcode !== undefined ? "leetcode" : "neetcode";
  const source = card.sources[platform];
  if (source === undefined) throw new Error("Carte sans plateforme");
  return {
    platform,
    slug: source.slug,
    title: card.title,
    difficulty: card.difficulty,
    frontendId: source.frontendId,
    listSlug: source.listSlug,
    metaIncomplete: card.metaIncomplete === true,
  };
}

// --- Câblage ----------------------------------------------------------------

function selectIn(root: Element, group: "mode" | "feel", chosen: Element): void {
  root.querySelectorAll(`[data-group="${group}"] .opt`).forEach((el) => {
    const selected = el === chosen;
    el.classList.toggle("sel", selected);
    el.setAttribute("aria-pressed", String(selected));
  });
}

function wire(cards: Record<string, ProblemCard>, pending: PendingAccepted | null): void {
  if (!app) return;

  app.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const problemId = btn.getAttribute("data-open");
      const card = problemId === null ? undefined : cards[problemId];
      if (card !== undefined) void browser.tabs.create({ url: problemUrl(card) });
    });
  });

  const abandonBtn = app.querySelector<HTMLButtonElement>("[data-abandon]");
  abandonBtn?.addEventListener("click", () => {
    const problemId = abandonBtn.getAttribute("data-abandon");
    const card = problemId !== null ? cards[problemId] : undefined;
    if (!card) return;
    abandonBtn.disabled = true;
    void sendToBackground({
      kind: "LOG_REVIEW",
      review: {
        problemId: card.id,
        problem: descriptorFromCard(card),
        mode: "abandon",
        feel: null,
        submissionsInSession: 0,
        minutesInSession: null,
      },
    })
      .then(render)
      .catch((err: unknown) => console.warn(`${LOG_PREFIX} abandon`, err));
  });

  app.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener("click", () => {
    void exportJson();
  });

  app.querySelectorAll<HTMLButtonElement>("[data-options]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void browser.runtime.openOptionsPage();
    });
  });

  if (pending !== null) {
    const block = app.querySelector<HTMLElement>("#pending");
    block?.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target.closest("button") : null;
      if (!target) return;

      const mode = target.getAttribute("data-mode");
      if (mode === "seul" || mode === "aide") {
        pendingMode = mode;
        selectIn(block, "mode", target);
        void refreshPendingPreview(pending);
        return;
      }
      const feel = target.getAttribute("data-feel");
      if (feel !== null) {
        pendingFeel = Number(feel) as Feel;
        selectIn(block, "feel", target);
        void refreshPendingPreview(pending);
        return;
      }
      if (target.hasAttribute("data-save-pending") && pendingMode !== null && pendingFeel !== null) {
        (target as HTMLButtonElement).disabled = true;
        void sendToBackground({
          kind: "LOG_REVIEW",
          review: reviewFromPending(pending, pendingMode, pendingFeel),
        })
          .then(() => {
            pendingMode = null;
            pendingFeel = null;
            return render();
          })
          .catch((err: unknown) => console.warn(`${LOG_PREFIX} save pending`, err));
      }
    });
  }
}

/** Export complet horodaté ; l'import et l'auto-sauvegarde sont dans les réglages. */
async function exportJson(): Promise<void> {
  const data = await getAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `companion-export-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

browser.storage.onChanged.addListener(() => {
  void render();
});

void render();
