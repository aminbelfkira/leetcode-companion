// Popup — option A (§9.2). Lectures directes du storage, mutations via
// messages au background (single-writer).

import { browser } from "wxt/browser";
import { LOG_PREFIX } from "../../src/config";
import { formatDueRelative } from "../../src/fsrs";
import { LC_ORIGIN, problemSlugFromPathname } from "../../src/lc-endpoints";
import { sendToBackground } from "../../src/messaging";
import { getAllData } from "../../src/storage";
import type { GithubSyncStatus } from "../../src/github/types";
import type { Feel, Mode, PendingAccepted, ProblemCard, ReviewInput } from "../../src/types";

const app = document.querySelector<HTMLDivElement>("#app");

const DAY_MS = 86_400_000;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function midnight(d: Date): number {
  const m = new Date(d);
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

function problemUrl(slug: string): string {
  return `${LC_ORIGIN}/problems/${slug}/`;
}

async function activeTrackedSlug(cards: Record<string, ProblemCard>): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const url = new URL(tab.url);
    if (url.origin !== LC_ORIGIN) return null;
    const slug = problemSlugFromPathname(url.pathname);
    return slug !== null && cards[slug] !== undefined ? slug : null;
  } catch {
    return null;
  }
}

async function render(): Promise<void> {
  if (!app) return;
  pendingMode = null;
  pendingFeel = null;
  const [data, github] = await Promise.all([
    getAllData(),
    sendToBackground({ kind: "GITHUB_GET_STATUS" }).catch(() => null),
  ]);
  const now = new Date();
  const nowMs = now.getTime();
  const todayMid = midnight(now);
  const tomorrowMid = todayMid + DAY_MS;
  const afterTomorrowMid = tomorrowMid + DAY_MS;
  const weekEnd = todayMid + 7 * DAY_MS;

  const all = Object.values(data.cards);
  const due = all
    .filter((c) => new Date(c.fsrs.due).getTime() <= nowMs)
    .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due));
  const dueTomorrow = all.filter((c) => {
    const t = new Date(c.fsrs.due).getTime();
    return t > nowMs && t >= tomorrowMid && t < afterTomorrowMid;
  }).length;
  const dueThisWeek = all.filter((c) => {
    const t = new Date(c.fsrs.due).getTime();
    return t > nowMs && t >= afterTomorrowMid && t < weekEnd;
  }).length;

  const dateLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const parts: string[] = [];
  parts.push(`
    <header>
      <h1>À réviser</h1>
      <span class="date">${esc(dateLabel)}</span>
      ${due.length > 0 ? `<span class="count">${due.length} du${due.length > 1 ? "s" : ""}</span>` : ""}
    </header>
  `);

  if (data.pendingAccepted !== null) {
    parts.push(pendingBlockHtml(data.pendingAccepted));
  }

  if (due.length === 0) {
    const next = all
      .filter((c) => new Date(c.fsrs.due).getTime() > nowMs)
      .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due))[0];
    parts.push(`
      <div class="card empty">
        <div class="big">Rien à réviser aujourd'hui 🎉</div>
        <div class="muted">${
          next !== undefined
            ? `prochain dû : ${esc(next.frontendId)}. ${esc(next.title)} · ${esc(formatDueRelative(next.fsrs.due, now))}`
            : "aucune carte suivie pour l'instant"
        }</div>
      </div>
    `);
  } else {
    const items = due
      .map((c) => {
        const dueMid = midnight(new Date(c.fsrs.due));
        const lateDays = Math.round((todayMid - dueMid) / DAY_MS);
        const chip =
          lateDays > 0
            ? `<span class="chip late">en retard · ${lateDays} j</span>`
            : `<span class="chip today">aujourd'hui</span>`;
        const feelTxt = c.lastFeel === null ? "—" : String(c.lastFeel);
        return `
          <div class="due-item">
            <div class="info">
              <div class="name">${esc(c.frontendId)}. ${esc(c.title)}${chip}</div>
              <div class="sub">${esc(c.lcDifficulty)} · ressenti ${feelTxt} · ${modeLabel(c.lastMode)} la dernière fois</div>
            </div>
            <button class="btn" data-open="${esc(c.slug)}">Ouvrir</button>
          </div>
        `;
      })
      .join("");
    parts.push(`<div class="card">${items}</div>`);
  }

  parts.push(
    `<div class="upcoming">à venir — demain · ${dueTomorrow} · cette semaine · ${dueThisWeek}</div>`,
  );

  const abandonSlug = await activeTrackedSlug(data.cards);
  if (abandonSlug !== null) {
    parts.push(`
      <button class="btn danger wide" data-abandon="${esc(abandonSlug)}">
        J'abandonne cette révision → à revoir demain
      </button>
    `);
  }

  if (github !== null) parts.push(githubBlockHtml(github));

  parts.push(`
    <footer>
      <button class="btn" data-export>Exporter (JSON)</button>
    </footer>
  `);

  app.innerHTML = parts.join("");
  wire(data.cards, data.pendingAccepted);
}

function githubBlockHtml(status: GithubSyncStatus): string {
  if (status.enabled && status.repository !== null) {
    const detail =
      status.lastError !== null
        ? `<span class="github-error">en attente · ${esc(status.lastError)}</span>`
        : status.pendingCount > 0
          ? `<span class="github-pending">${status.pendingCount} en attente</span>`
          : `<span class="github-ok">synchronisation active</span>`;
    return `
      <div class="card github-card">
        <div class="github-copy">
          <div class="section-title">GitHub Sync</div>
          <div class="github-repo">${esc(status.repository.fullName)}</div>
          ${detail}
        </div>
        <button class="btn" data-github-settings>Gérer</button>
      </div>`;
  }
  return `
    <div class="card github-card">
      <div class="github-copy">
        <div class="section-title">GitHub Sync</div>
        <div class="github-repo">Sauvegarder les Accepted automatiquement</div>
        <span class="muted">activation unique</span>
      </div>
      <button class="btn${status.available ? " primary" : ""}" data-github-settings>
        ${status.connected ? "Terminer" : "Activer"}
      </button>
    </div>`;
}

// --- Bloc « Noter le dernier Accepted » (§9.2) ------------------------------

let pendingMode: Extract<Mode, "seul" | "aide"> | null = null;
let pendingFeel: Feel | null = null;

function pendingBlockHtml(p: PendingAccepted): string {
  return `
    <div class="card" id="pending">
      <div class="section-title">Noter le dernier Accepted : <b>${esc(p.frontendId)}. ${esc(p.title)}</b></div>
      <div class="rate-row" data-group="mode">
        <button class="opt" data-mode="seul">Seul</button>
        <button class="opt" data-mode="aide">Avec aide<small>IA · YouTube · solution</small></button>
      </div>
      <div class="rate-row" data-group="feel">
        <button class="opt" data-feel="1">1<small>fluide</small></button>
        <button class="opt" data-feel="2">2<small>correct</small></button>
        <button class="opt" data-feel="3">3<small>laborieux</small></button>
        <button class="opt" data-feel="4">4<small>à l'arraché</small></button>
      </div>
      <div class="next-line">Prochaine révision : <b>—</b></div>
      <button class="btn primary wide" data-save-pending disabled>Enregistrer la révision</button>
    </div>
  `;
}

async function refreshPendingPreview(p: PendingAccepted): Promise<void> {
  const nextEl = document.querySelector<HTMLElement>("#pending .next-line b");
  const saveBtn = document.querySelector<HTMLButtonElement>("[data-save-pending]");
  if (pendingMode === null || pendingFeel === null || !nextEl || !saveBtn) return;
  saveBtn.disabled = false;
  try {
    const { scheduledDue } = await sendToBackground({
      kind: "PREVIEW_REVIEW",
      slug: p.slug,
      mode: pendingMode,
      feel: pendingFeel,
    });
    nextEl.textContent = formatDueRelative(scheduledDue);
  } catch {
    nextEl.textContent = "—";
  }
}

function reviewFromPending(p: PendingAccepted, mode: Mode, feel: Feel): ReviewInput {
  return {
    slug: p.slug,
    frontendId: p.frontendId,
    title: p.title,
    lcDifficulty: p.lcDifficulty,
    metaIncomplete: p.lcDifficulty === "Unknown",
    mode,
    feel,
    submissionsInSession: p.submissionsInSession,
    minutesInSession: p.minutesInSession,
  };
}

// --- Câblage ----------------------------------------------------------------

function wire(cards: Record<string, ProblemCard>, pending: PendingAccepted | null): void {
  if (!app) return;

  app.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.getAttribute("data-open");
      if (slug !== null) void browser.tabs.create({ url: problemUrl(slug) });
    });
  });

  const abandonBtn = app.querySelector<HTMLButtonElement>("[data-abandon]");
  abandonBtn?.addEventListener("click", () => {
    const slug = abandonBtn.getAttribute("data-abandon");
    const card = slug !== null ? cards[slug] : undefined;
    if (!card) return;
    abandonBtn.disabled = true;
    void sendToBackground({
      kind: "LOG_REVIEW",
      review: {
        slug: card.slug,
        frontendId: card.frontendId,
        title: card.title,
        lcDifficulty: card.lcDifficulty,
        metaIncomplete: card.metaIncomplete === true,
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

  app.querySelector<HTMLButtonElement>("[data-github-settings]")?.addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
  });

  if (pending !== null) {
    const block = app.querySelector<HTMLDivElement>("#pending");
    block?.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target.closest("button") : null;
      if (!target) return;
      const mode = target.getAttribute("data-mode");
      if (mode === "seul" || mode === "aide") {
        pendingMode = mode;
        block
          .querySelectorAll(`[data-group="mode"] .opt`)
          .forEach((el) => el.classList.toggle("sel", el === target));
        void refreshPendingPreview(pending);
        return;
      }
      const feel = target.getAttribute("data-feel");
      if (feel !== null) {
        pendingFeel = Number(feel) as Feel;
        block
          .querySelectorAll(`[data-group="feel"] .opt`)
          .forEach((el) => el.classList.toggle("sel", el === target));
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

/** Export §9.2 : { schemaVersion, cards, log, settings }, horodaté. */
async function exportJson(): Promise<void> {
  const { schemaVersion, cards, log, settings } = await getAllData();
  const blob = new Blob([JSON.stringify({ schemaVersion, cards, log, settings }, null, 2)], {
    type: "application/json",
  });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `lcfsrs-export-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

browser.storage.onChanged.addListener(() => {
  void render();
});

void render();
