import { browser } from "wxt/browser";
import { GITHUB_PERMISSION_ORIGINS } from "../../src/github/config";
import type {
  GithubDeviceFlowStart,
  GithubRepository,
  GithubSyncStatus,
} from "../../src/github/types";
import { sendToBackground } from "../../src/messaging";

const app = document.querySelector<HTMLElement>("#app");
let pollTimer: number | null = null;
let repositories: GithubRepository[] = [];
let showRepositoryPicker = false;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function formatDate(value: string | null): string {
  if (value === null) return "jamais";
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function stopPolling(): void {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
}

async function status(): Promise<GithubSyncStatus> {
  return sendToBackground({ kind: "GITHUB_GET_STATUS" });
}

async function render(): Promise<void> {
  if (app === null) return;
  stopPolling();
  try {
    const current = await status();
    if (!current.available) {
      app.innerHTML = `
        <div class="panel warning">
          <h2>GitHub App non configurée</h2>
          <p>Ce build doit définir <code>WXT_GITHUB_CLIENT_ID</code> et
          <code>WXT_GITHUB_APP_SLUG</code>. Les fonctions FSRS restent entièrement disponibles.</p>
        </div>`;
      return;
    }
    if (!current.connected) {
      renderDisconnected(current);
      return;
    }
    if (!current.enabled || showRepositoryPicker) {
      await renderRepositorySelection(current);
      return;
    }
    renderEnabled(current);
  } catch (error) {
    renderError(error);
  }
}

function renderDisconnected(current: GithubSyncStatus): void {
  if (app === null) return;
  app.innerHTML = `
    <div class="steps">
      <div class="panel step">
        <span class="step-number">1</span>
        <div>
          <h2>Autoriser un dépôt</h2>
          <p>Installe la GitHub App uniquement sur le dépôt qui recevra tes solutions.</p>
          ${
            current.installationUrl === null
              ? `<p class="error">URL d'installation GitHub App manquante dans ce build.</p>`
              : `<button class="secondary" data-install>Choisir le dépôt sur GitHub ↗</button>`
          }
        </div>
      </div>
      <div class="panel step">
        <span class="step-number">2</span>
        <div>
          <h2>Connecter le compte</h2>
          <p>GitHub affichera un code d'autorisation. Aucun mot de passe n'est demandé ici.</p>
          <button class="primary" data-connect>Connecter GitHub</button>
        </div>
      </div>
    </div>`;

  app.querySelector<HTMLButtonElement>("[data-install]")?.addEventListener("click", () => {
    if (current.installationUrl !== null) {
      void browser.tabs.create({ url: current.installationUrl });
    }
  });
  app.querySelector<HTMLButtonElement>("[data-connect]")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    void connectGithub().catch(renderError);
  });
}

async function connectGithub(): Promise<void> {
  const granted = await browser.permissions.request({
    origins: [...GITHUB_PERMISSION_ORIGINS],
  });
  if (!granted) throw new Error("La permission GitHub a été refusée");
  const flow = await sendToBackground({ kind: "GITHUB_START_DEVICE_FLOW" });
  renderDeviceCode(flow);
  await browser.tabs.create({ url: flow.verificationUri });
  schedulePoll(flow.intervalSeconds);
}

function renderDeviceCode(flow: GithubDeviceFlowStart): void {
  if (app === null) return;
  app.innerHTML = `
    <div class="panel auth">
      <div class="spinner" aria-hidden="true"></div>
      <h2>Autorisation GitHub en cours</h2>
      <p>Dans l'onglet GitHub qui vient de s'ouvrir, saisis ce code :</p>
      <button class="device-code" data-copy title="Copier le code">${escapeHtml(flow.userCode)}</button>
      <p class="muted">Cette page détectera automatiquement la connexion.</p>
      <button class="secondary" data-reopen>Rouvrir GitHub ↗</button>
    </div>`;
  app.querySelector<HTMLButtonElement>("[data-copy]")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(flow.userCode);
  });
  app.querySelector<HTMLButtonElement>("[data-reopen]")?.addEventListener("click", () => {
    void browser.tabs.create({ url: flow.verificationUri });
  });
}

function schedulePoll(seconds: number): void {
  stopPolling();
  pollTimer = window.setTimeout(() => void pollAuthorization(), seconds * 1_000);
}

async function pollAuthorization(): Promise<void> {
  try {
    const result = await sendToBackground({ kind: "GITHUB_POLL_DEVICE_FLOW" });
    switch (result.state) {
      case "pending":
        schedulePoll(result.retryAfterSeconds);
        return;
      case "connected":
        repositories = [];
        showRepositoryPicker = true;
        await render();
        return;
      case "expired":
        throw new Error("Le code GitHub a expiré. Relance la connexion.");
      case "denied":
        throw new Error("L'autorisation GitHub a été annulée.");
    }
  } catch (error) {
    renderError(error);
  }
}

async function renderRepositorySelection(current: GithubSyncStatus): Promise<void> {
  if (app === null) return;
  app.innerHTML = `
    <div class="panel auth">
      <div class="spinner" aria-hidden="true"></div>
      <h2>Chargement des dépôts autorisés…</h2>
    </div>`;
  try {
    const response = await sendToBackground({ kind: "GITHUB_LIST_REPOSITORIES" });
    repositories = response.repositories;
  } catch (error) {
    renderError(error);
    return;
  }

  if (repositories.length === 0) {
    app.innerHTML = `
      <div class="panel warning">
        <h2>Aucun dépôt autorisé</h2>
        <p>Installe LeetCode Companion sur un dépôt GitHub, puis actualise cette liste.</p>
        <div class="actions">
          ${
            current.installationUrl === null
              ? ""
              : `<button class="primary" data-install>Choisir un dépôt ↗</button>`
          }
          <button class="secondary" data-refresh>Actualiser</button>
        </div>
      </div>`;
    app.querySelector<HTMLButtonElement>("[data-install]")?.addEventListener("click", () => {
      if (current.installationUrl !== null) void browser.tabs.create({ url: current.installationUrl });
    });
    app.querySelector<HTMLButtonElement>("[data-refresh]")?.addEventListener("click", () => {
      void render();
    });
    return;
  }

  const options = repositories
    .map(
      (repository) =>
        `<option value="${repository.id}" ${repository.id === current.repository?.id ? "selected" : ""}>${escapeHtml(repository.fullName)}${repository.private ? " · privé" : " · public"}</option>`,
    )
    .join("");
  app.innerHTML = `
    <div class="panel">
      <div class="connected-user">✓ Connecté en tant que <b>${escapeHtml(current.userLogin ?? "GitHub")}</b></div>
      <h2>Choisir le dépôt de solutions</h2>
      <p>L'extension n'utilisera que le dépôt sélectionné ici.</p>
      <label>
        Dépôt
        <select data-repository>${options}</select>
      </label>
      <div class="actions">
        <button class="primary" data-select>Activer la synchronisation</button>
        ${current.enabled ? `<button class="secondary" data-cancel>Annuler</button>` : ""}
      </div>
    </div>`;

  app.querySelector<HTMLButtonElement>("[data-select]")?.addEventListener("click", (event) => {
    const select = app.querySelector<HTMLSelectElement>("[data-repository]");
    const repositoryId = select === null ? Number.NaN : Number(select.value);
    if (!Number.isFinite(repositoryId)) return;
    (event.currentTarget as HTMLButtonElement).disabled = true;
    void sendToBackground({ kind: "GITHUB_SELECT_REPOSITORY", repositoryId })
      .then(() => {
        showRepositoryPicker = false;
        return render();
      })
      .catch(renderError);
  });
  app.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => {
    showRepositoryPicker = false;
    void render();
  });
}

function renderEnabled(current: GithubSyncStatus): void {
  if (app === null || current.repository === null) return;
  const error =
    current.lastError === null
      ? ""
      : `<div class="sync-error"><b>Synchronisation en attente</b><span>${escapeHtml(current.lastError)}</span></div>`;
  app.innerHTML = `
    <div class="panel enabled">
      <div class="status-line"><span class="status-dot"></span> Synchronisation active</div>
      <h2>${escapeHtml(current.repository.fullName)}</h2>
      <p>Chaque nouvel Accepted met à jour automatiquement le fichier de solution.</p>
      <dl>
        <div><dt>Dernière synchronisation</dt><dd>${escapeHtml(formatDate(current.lastSyncAt))}</dd></div>
        <div><dt>Fichier</dt><dd>${escapeHtml(current.lastSyncedPath ?? "—")}</dd></div>
        <div><dt>En attente</dt><dd>${current.pendingCount}</dd></div>
      </dl>
      ${error}
      <div class="actions">
        ${current.pendingCount > 0 ? `<button class="primary" data-retry>Réessayer</button>` : ""}
        <button class="secondary" data-change>Changer de dépôt</button>
        <button class="danger" data-disconnect>Déconnecter</button>
      </div>
    </div>`;
  app.querySelector<HTMLButtonElement>("[data-retry]")?.addEventListener("click", () => {
    void sendToBackground({ kind: "GITHUB_RETRY_QUEUE" }).then(render).catch(renderError);
  });
  app.querySelector<HTMLButtonElement>("[data-change]")?.addEventListener("click", () => {
    showRepositoryPicker = true;
    void render();
  });
  app.querySelector<HTMLButtonElement>("[data-disconnect]")?.addEventListener("click", () => {
    if (!window.confirm("Déconnecter GitHub et supprimer le token ainsi que la file locale ?")) return;
    void sendToBackground({ kind: "GITHUB_DISCONNECT" }).then(render).catch(renderError);
  });
}

function renderError(error: unknown): void {
  stopPolling();
  if (app === null) return;
  const message = error instanceof Error ? error.message : String(error);
  app.innerHTML = `
    <div class="panel warning">
      <h2>Impossible de continuer</h2>
      <p class="error">${escapeHtml(message)}</p>
      <button class="secondary" data-back>Revenir</button>
    </div>`;
  app.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => {
    void render();
  });
}

void render();
