// Layered source fetching: dev proxy → edge function → public CORS
// proxy → direct. Extracted from NativeReader so catalog code and other
// sources share it.

const looksLikeHtml = (text) => {
  const head = text.slice(0, 500).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
};

// Dev-only Vite proxies (see vite.config.js). In production these paths serve
// the SPA shell or 404, which looksLikeHtml / !res.ok filters out.
const devProxyFor = (url) => {
  if (url.includes('gutenberg.org')) return url.replace(/^https?:\/\/[^/]+/, '/gutenberg');
  if (url.includes('archive.org')) return url.replace(/^https?:\/\/[^/]+/, '/ia');
  if (url.includes('standardebooks.org')) return url.replace(/^https?:\/\/[^/]+/, '/se');
  return null;
};

export const fetchWithProxy = async (url, responseType = 'text', signal = null) => {
  const devProxy = devProxyFor(url);
  const proxyMakers = [
    ...(devProxy ? [{ make: () => devProxy, timeout: 20000 }] : []),
    { make: () => `/api/proxy?url=${encodeURIComponent(url)}`, timeout: 25000 },
    { make: () => `https://corsproxy.io/?${encodeURIComponent(url)}`, timeout: 10000 },
    { make: () => url, timeout: 10000 }
  ];

  for (const item of proxyMakers) {
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const proxyUrl = item.make();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), item.timeout); // Adaptive timeout

      const abortHandler = () => {
        controller.abort();
      };
      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }

      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }

      if (!res.ok) continue;
      if (responseType === 'arraybuffer') return await res.arrayBuffer();

      const text = await res.text();
      // Reject HTML shells (SPA fallback / wrong route / error pages) that
      // would otherwise be parsed as book content.
      if (responseType === 'text' && looksLikeHtml(text)) {
        continue;
      }
      // Check for corsproxy.io pricing/error responses disguised as 200 OK
      if (text.includes("Server-side requests are not allowed") || text.includes("Upgrade at https://corsproxy.io")) {
        console.warn("corsproxy.io pricing limit reached, trying next fallback");
        continue;
      }
      return text;
    } catch (e) {
      if (e.name === 'AbortError' && signal?.aborted) {
        throw e;
      }
      continue; // try next proxy
    }
  }
  throw new Error(`All proxies failed for: ${url}`);
};
export { looksLikeHtml, devProxyFor };
