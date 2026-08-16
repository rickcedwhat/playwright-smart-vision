import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures',
);

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/customer.html' : req.url;
  const file = path.join(fixturesDir, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('Fixture server: port 4321 already in use — reusing existing server.');
    process.exit(0);
  }
  throw err;
});

server.listen(4321, '127.0.0.1', () => {
  console.log('Fixture server ready on http://localhost:4321');
});
