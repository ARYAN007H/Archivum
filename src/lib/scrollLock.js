// Single source of truth for page scroll locking (Lenis + native fallback).
// Components may nest locks (detail modal -> reader); the page only unlocks
// when every consumer has released its lock, so an early unmount can never
// leave Lenis permanently stopped.

let lockCount = 0;

// Exposed for debugging lock leaks from the console / e2e tooling.
export function getScrollLockCount() {
  return lockCount;
}

export function lockPageScroll() {
  lockCount++;
  if (import.meta.env.DEV) console.debug('[scrollLock] lock →', lockCount);
  window.__lenis?.stop();
  document.body.style.overflow = 'hidden';
}

export function unlockPageScroll() {
  if (lockCount > 0) lockCount--;
  if (import.meta.env.DEV) console.debug('[scrollLock] unlock →', lockCount);
  if (lockCount === 0) {
    window.__lenis?.start();
    document.body.style.overflow = '';
  }
}

// Smooth scroll that actually respects Lenis when present.
// (scrollTo() returns undefined, so a `lenis.scrollTo() || window.scrollTo()`
// fallback always runs and cancels the animation — use this instead.)
export function scrollToPosition(top, options = {}) {
  if (window.__lenis) {
    window.__lenis.scrollTo(top, options);
  } else {
    window.scrollTo({ top, behavior: options.immediate ? 'auto' : 'smooth' });
  }
}
