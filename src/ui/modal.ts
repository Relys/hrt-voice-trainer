export interface ModalController {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Wraps a backdrop/panel pair with the accessibility behavior a modal needs: ARIA role/labelling,
 * focus moved in on open and restored to whatever triggered it on close, Escape to close, and a
 * focus trap so Tab can't leave the dialog while it's open.
 */
export function createModal(backdrop: HTMLElement, panel: HTMLElement): ModalController {
  let previouslyFocused: HTMLElement | null = null;
  let isOpen = false;

  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.tabIndex = -1;
  const heading = panel.querySelector("h2");
  if (heading) {
    if (!heading.id) heading.id = `modal-heading-${Math.random().toString(36).slice(2, 9)}`;
    panel.setAttribute("aria-labelledby", heading.id);
  }

  function getFocusable(): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null,
    );
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    previouslyFocused = document.activeElement as HTMLElement | null;
    backdrop.hidden = false;
    document.addEventListener("keydown", onKeydown);
    const focusable = getFocusable();
    (focusable[0] ?? panel).focus({ preventScroll: true });
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    backdrop.hidden = true;
    document.removeEventListener("keydown", onKeydown);
    previouslyFocused?.focus({ preventScroll: true });
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  return { open, close, isOpen: () => isOpen };
}
