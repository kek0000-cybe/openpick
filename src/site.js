import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

/**
 * Sifir bagimlilikli onizleme sunucusu.
 * GitHub Pages'e gondermeden once siteyi yerelde aynen gormek icin.
 * file:// yerine http:// gerekiyor cunku sayfalar fetch kullaniyor.
 */
const dir = path.join(ROOT, 'docs');
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(dir, url);
  // Yol gezinmesini engelle
  if (!file.startsWith(dir)) {
    res.writeHead(403).end('yasak');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('bulunamadi: ' + url);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`\n  Onizleme: http://localhost:${port}\n  Durdurmak icin Ctrl+C\n`);
});
