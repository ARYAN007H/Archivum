export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    // Forward the browser's User-Agent: some sources (archive.org, gutendex)
    // respond badly to datacenter traffic carrying a custom client UA — the
    // same request with a browser UA succeeds.
    const ua = req.headers.get('user-agent')
      || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

    // Fail fast instead of hanging: the reader's fetch chain has further
    // fallbacks (public CORS proxy, direct) that only help if this returns.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let response;
    try {
      response = await fetch(targetUrl, {
        headers: { 'User-Agent': ua, Accept: '*/*' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return new Response(`Error fetching target: ${response.statusText}`, { status: response.status });
    }

    const blob = await response.blob();

    return new Response(blob, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      },
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return new Response(`Proxy error: ${aborted ? 'upstream timeout' : error.message}`, {
      status: aborted ? 504 : 500,
    });
  }
}
