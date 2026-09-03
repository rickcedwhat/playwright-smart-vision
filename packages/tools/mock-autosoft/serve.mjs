import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const PORT = 3001;
const SCREENS_DIR = path.join(os.homedir(), '.smart-vision/screens');
const MOCK_DIR = path.dirname(fileURLToPath(import.meta.url));

const MIME = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript' };

http.createServer((req, res) => {
  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(MOCK_DIR, 'index.html');
  } else if (req.url.startsWith('/screens/')) {
    filePath = path.join(SCREENS_DIR, decodeURIComponent(req.url.slice('/screens/'.length)));
  } else {
    res.writeHead(404); res.end(); return;
  }
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
}).listen(PORT, () => console.log(`Mock AutoSoft → http://localhost:${PORT}`));
