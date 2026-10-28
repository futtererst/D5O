// Loopback-only proxy for disposable local qualification services.
// Fixed destinations and no production credentials or production route.
import http from 'node:http';

const targets = [
  ['/auth/v1', 56631],
  ['/rest/v1', 56632],
  ['/storage/v1', 56633],
];
http.createServer((req, res) => {
  const match = targets.find(([prefix]) => req.url === prefix || req.url?.startsWith(prefix + '/'));
  if (!match) { res.writeHead(404); res.end(); return; }
  const [prefix, port] = match;
  const path = req.url.slice(prefix.length) || '/';
  const upstream = http.request({ hostname: '127.0.0.1', port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(56621, '127.0.0.1');
