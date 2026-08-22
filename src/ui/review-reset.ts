// Réinitialise l'éditeur uniquement lorsqu'un problème est ouvert depuis une
// révision Companion. On délègue à l'action native de LeetCode afin de garder
// exactement la classe, la signature et le langage actuellement sélectionné.

import { LOG_PREFIX } from "../config";
import {
  isReviewLaunchSearch,
  withoutReviewLaunchMarker,
} from "../lc-endpoints";

const RESET_ICON_SELECTOR = "#editor svg.fa-arrow-rotate-left";
const EDITOR_SELECTOR = '#editor [aria-label="Code editor"]';
const RESET_DIALOG_COPY = "Your current code will be discarded and reset to the default code!";
const RESET_CONFIRM_LABEL = "Confirm";
const RESET_TIMEOUT_MS = 20_000;

let resetInProgress = false;

function clearReviewMarker(): void {
  try {
    history.replaceState(history.state, "", withoutReviewLaunchMarker(location.href));
  } catch {
    // Le reset est plus important que le nettoyage cosmétique de l'URL.
  }
}

function nativeResetButton(): HTMLButtonElement | null {
  if (document.querySelector(EDITOR_SELECTOR) === null) return null;
  const icon = document.querySelector<SVGElement>(RESET_ICON_SELECTOR);
  const button = icon?.closest("button");
  return button instanceof HTMLButtonElement && !button.disabled ? button : null;
}

function nativeConfirmButton(): HTMLButtonElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  for (const dialog of dialogs) {
    if (!dialog.textContent?.includes(RESET_DIALOG_COPY)) continue;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("button")) {
      if (button.textContent?.trim() === RESET_CONFIRM_LABEL && !button.disabled) return button;
    }
  }
  return null;
}

export function resetEditorForCompanionReview(): void {
  if (resetInProgress || !isReviewLaunchSearch(location.search)) return;
  resetInProgress = true;

  let resetClicked = false;
  let confirmClicked = false;
  let finished = false;
  let timeoutId: number | null = null;
  const observer = new MutationObserver(progress);

  function finish(success: boolean): void {
    if (finished) return;
    finished = true;
    observer.disconnect();
    document.removeEventListener("DOMContentLoaded", startObserving);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    clearReviewMarker();
    resetInProgress = false;
    if (success) {
      console.log(`${LOG_PREFIX} code initial restauré pour la révision`);
    } else {
      console.warn(`${LOG_PREFIX} reset natif LeetCode indisponible`);
    }
  }

  function progress(): void {
    if (finished) return;
    if (!resetClicked) {
      const reset = nativeResetButton();
      if (reset === null) return;
      resetClicked = true;
      reset.click();
    }

    if (confirmClicked) return;
    const confirm = nativeConfirmButton();
    if (confirm === null) return;
    confirmClicked = true;
    confirm.click();
    // Laisse React appliquer le handler du dialogue avant de retirer le marqueur.
    window.setTimeout(() => finish(true), 0);
  }

  function startObserving(): void {
    if (finished) return;
    const root = document.documentElement;
    if (root === null) return;
    observer.observe(root, { childList: true, subtree: true });
    progress();
  }

  if (document.documentElement === null) {
    document.addEventListener("DOMContentLoaded", startObserving, { once: true });
  } else {
    startObserving();
  }

  timeoutId = window.setTimeout(() => finish(false), RESET_TIMEOUT_MS);
}
