import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNodeDetail, getSession, listProjects, listSessions } from './store.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // Everything here is local, private transcript data: never let a page cache it.
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function handleApi(url: URL, res: http.ServerResponse): Promise<boolean> {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  if (parts[0] === 'projects' && parts.length === 1) {
    sendJson(res, 200, await listProjects());
    return true;
  }
  if (parts[0] === 'projects' && parts[2] === 'sessions' && parts.length === 3) {
    sendJson(res, 200, await listSessions(decodeURIComponent(parts[1])));
    return true;
  }
  if (parts[0] === 'sessions' && parts.length === 3) {
    const scan = await getSession(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    sendJson(res, 200, {
      id: scan.id,
      name: scan.title,
      nodes: scan.nodes,
      currentLeafId: scan.currentLeafId,
      summary: scan.summary,
    });
    return true;
  }
  if (parts[0] === 'sessions' && parts[3] === 'nodes' && parts.length === 5) {
    const detail = await getNodeDetail(
      decodeURIComponent(parts[1]),
      decodeURIComponent(parts[2]),
      decodeURIComponent(parts[4]),
    );
    if (!detail) sendJson(res, 404, { error: 'No such node in this session.' });
    else sendJson(res, 200, detail);
    return true;
  }
  return false;
}

function serveStatic(url: URL, res: http.ServerResponse): void {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(webRoot, relative);

  // The viewer serves local files; refuse anything that escapes the web root.
  if (!file.startsWith(webRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void (async () => {
      try {
        if (url.pathname.startsWith('/api/')) {
          if (await handleApi(url, res)) return;
          sendJson(res, 404, { error: 'Unknown endpoint.' });
          return;
        }
        serveStatic(url, res);
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
}

export function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Loopback only — these transcripts should never leave the machine.
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}
