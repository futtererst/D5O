// Fixed-destination loopback proxy for the disposable RC13 app container.
// It never listens on a container or host network interface.
import http from 'node:http';

const targets = [
  ['/auth/v1', 'd5o-rc13-auth', 9999],
  ['/rest/v1', 'd5o-rc13-rest', 3000],
  ['/storage/v1', 'd5o-rc12-storage', 5000],
];
http.createServer((req, res) => {
  const target = targets.find(([prefix]) => req.url === prefix || req.url?.startsWith(`${prefix}/`));
  if (!target) { res.writeHead(404); res.end(); return; }
  const [prefix, hostname, port] = target;
  const upstream = http.request({ hostname, port, path: req.url.slice(prefix.length) || '/', method: req.method,
    headers: { ...req.headers, host: `${hostname}:${port}` } }, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(56621, '127.0.0.1');
