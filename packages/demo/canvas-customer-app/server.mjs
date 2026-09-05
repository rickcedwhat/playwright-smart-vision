import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3456;

const server = createServer(async (req, res) => {
  try {
    const filePath = join(__dirname, 'index.html');
    const content = await readFile(filePath, 'utf8');
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n✨ Canvas Customer Form Demo`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`\n📝 Test Data: Click "Fill Test Data" button`);
  console.log(`🔍 OCR Testing: Text is rendered on canvas (requires OCR to read)\n`);
});
