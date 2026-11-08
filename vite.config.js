import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only CORS-free paths for the book sources. gutenberg.org never sends
// CORS headers, most public CORS proxies are rate-limited or dead, and the
// FastAPI backend isn't required to read — so in dev we transparently proxy
// the sources ourselves. Node's fetch follows the 302s gutenberg.org issues.
// In production these paths 404/serve the SPA shell; the fetch chain detects
// that and falls through to the next strategy.
const sourceProxyPlugin = () => ({
  name: 'archivum-source-proxy',
  configureServer(server) {
    const proxySource = (prefix, origin) => async (req, res) => {
      // Connect strips the mount prefix from req.url before calling us
      const target = origin + req.url;
      try {
        const upstream = await fetch(target, {
          headers: { 'User-Agent': 'ArchivumReader/1.0 (+https://github.com/ARYAN007H/Archivum)' },
          redirect: 'follow',
        });
        const body = new Uint8Array(await upstream.arrayBuffer());
        res.statusCode = upstream.status;
        const type = upstream.headers.get('content-type');
        if (type) res.setHeader('Content-Type', type);
        res.end(body);
      } catch (e) {
        console.error(`[source-proxy] ${target} → ${e.cause?.code || e.cause?.message || e.message}`);
        res.statusCode = 502;
        res.end(`proxy error: ${e.message}`);
      }
    };
    server.middlewares.use('/gutenberg', proxySource('/gutenberg', 'https://www.gutenberg.org'));
    server.middlewares.use('/ia', proxySource('/ia', 'https://archive.org'));
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), sourceProxyPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    }
  }
})
