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

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'ArchivumReader/1.0 (Vercel Edge Proxy)',
      },
    });

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
    return new Response(`Proxy error: ${error.message}`, { status: 500 });
  }
}
