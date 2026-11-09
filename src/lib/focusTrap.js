// Keep Tab focus inside an open modal/panel. Bind on open, call the returned
// cleanup on close. Focuses the panel's first focusable element if focus is
// currently outside the container.
export function trapFocusIn(container) {
  if (!container) return () => {};
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';
  const visibleFocusables = () => [...container.querySelectorAll(selector)]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);

  if (!container.contains(document.activeElement)) {
    visibleFocusables()[0]?.focus();
  }

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = visibleFocusables();
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstEl || !container.contains(active))) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && (active === lastEl || !container.contains(active))) {
      e.preventDefault();
      firstEl.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}
