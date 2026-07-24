/**
 * Wires up every `.info-btn` inside `container` to toggle its associated `.info-bubble` (found
 * via `aria-controls`), positioned as a fixed-position popover computed from the button's own
 * rect — this sidesteps clipping against ancestor `overflow: hidden`/flex-wrap layouts entirely,
 * rather than relying on CSS-relative absolute positioning that would fight the HUD's own
 * overflow-hidden gradient-bar clipping.
 */
export function setupInfoBubbles(container: HTMLElement): void {
  function bubbleFor(btn: HTMLButtonElement): HTMLElement | null {
    const id = btn.getAttribute("aria-controls");
    return id ? document.getElementById(id) : null;
  }

  function close(btn: HTMLButtonElement): void {
    const bubble = bubbleFor(btn);
    if (!bubble) return;
    bubble.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function closeAll(except?: HTMLButtonElement): void {
    for (const btn of container.querySelectorAll<HTMLButtonElement>(".info-btn")) {
      if (btn !== except) close(btn);
    }
  }

  function open(btn: HTMLButtonElement): void {
    const bubble = bubbleFor(btn);
    if (!bubble) return;
    const rect = btn.getBoundingClientRect();
    bubble.style.top = `${rect.bottom + 6}px`;
    bubble.style.left = `${rect.left}px`;
    bubble.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    // Clamp inside the viewport horizontally once we know the bubble's own rendered width.
    requestAnimationFrame(() => {
      const overflowRight = bubble.getBoundingClientRect().right - window.innerWidth + 8;
      if (overflowRight > 0) bubble.style.left = `${Math.max(8, rect.left - overflowRight)}px`;
    });
  }

  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".info-btn");
    if (!btn) return;
    e.stopPropagation();
    const bubble = bubbleFor(btn);
    if (!bubble) return;
    const wasOpen = !bubble.hidden;
    closeAll(btn);
    if (wasOpen) close(btn);
    else open(btn);
  });

  document.addEventListener("click", () => closeAll());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}
