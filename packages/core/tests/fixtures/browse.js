
const KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'var', 'await', 'async',
  'function', 'return', 'new', 'try', 'finally', 'if', 'else', 'typeof',
  'true', 'false', 'null', 'undefined', 'of', 'in', 'as',
]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightLine(line, inBlock) {
  if (inBlock) {
    const end = line.indexOf('*/');
    if (end === -1) return { html: `<span class="cm">${escapeHtml(line)}</span>`, inBlock: true };
    const rest = highlightLine(line.slice(end + 2), false);
    return {
      html: `<span class="cm">${escapeHtml(line.slice(0, end + 2))}</span>${rest.html}`,
      inBlock: false,
    };
  }

  const re = /(\/\/.*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*|`(?:\\.|[^`])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[A-Za-z_$][\w$]*|\d+\.?\d*|\s+|[\s\S])/g;
  const tokens = line.match(re) || [line];
  let html = '';
  let block = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens.slice(i + 1).find((part) => part.trim());
    if (token.startsWith('/*') && !token.endsWith('*/')) {
      html += `<span class="cm">${escapeHtml(token)}</span>`;
      block = true;
    } else if (token.startsWith('//') || token.startsWith('/*')) {
      html += `<span class="cm">${escapeHtml(token)}</span>`;
    } else if (/^['"][^'"]+\.png['"]$/.test(token)) {
      html += `<span class="str tpl" data-template="${escapeHtml(token.slice(1, -1))}">${escapeHtml(token)}</span>`;
    } else if (token.startsWith("'") || token.startsWith('"') || token.startsWith('`')) {
      html += `<span class="str">${escapeHtml(token)}</span>`;
    } else if (KEYWORDS.has(token)) {
      html += `<span class="kw">${escapeHtml(token)}</span>`;
    } else if (/^\d/.test(token)) {
      html += `<span class="num">${escapeHtml(token)}</span>`;
    } else if (/^[A-Za-z_$]/.test(token) && next === '(') {
      html += `<span class="fn">${escapeHtml(token)}</span>`;
    } else if (/^[A-Z][A-Za-z0-9]+$/.test(token)) {
      html += `<span class="ty">${escapeHtml(token)}</span>`;
    } else if (/^[A-Za-z_$][\w$]*$/.test(token) && next === ':') {
      html += `<span class="pr">${escapeHtml(token)}</span>`;
    } else {
      html += escapeHtml(token);
    }
  }
  return { html, inBlock: block };
}

function renderCode(source) {
  const lines = source.split('\n');
  let inBlock = false;
  let currentTemplate = '';
  return lines.map((line, i) => {
    const templateMatch = line.match(/template:\s*'([^']+\.png)'/);
    if (templateMatch) currentTemplate = templateMatch[1];
    const result = highlightLine(line, inBlock);
    inBlock = result.inBlock;
    const partMatch = line.match(
      /\{\s*name:\s*'([^']+)'\s*,\s*x:\s*(-?\d+)\s*,\s*y:\s*(-?\d+)\s*,\s*width:\s*(-?\d+)\s*,\s*height:\s*(-?\d+)/
    );
    let inner = result.html || ' ';
    if (partMatch && currentTemplate) {
      inner = `<span class="tpl part" data-template="${escapeHtml(currentTemplate)}" data-part="${escapeHtml(partMatch[1])}" data-x="${partMatch[2]}" data-y="${partMatch[3]}" data-width="${partMatch[4]}" data-height="${partMatch[5]}">${inner}</span>`;
    }
    return `<div class="row"><span class="ln">${i + 1}</span><span class="line">${inner}</span></div>`;
  }).join('');
}

async function fetchSource(file) {
  const res = await fetch(`/api/source?file=${encodeURIComponent(file)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not load ${file}`);
  return body;
}

function placePopover(anchor, popover) {
  const rect = anchor.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const pad = 10;
  let top = rect.bottom + pad;
  let left = rect.left;
  if (top + box.height > window.innerHeight - 8) top = rect.top - box.height - pad;
  if (left + box.width > window.innerWidth - 8) left = window.innerWidth - box.width - 8;
  popover.style.top = `${Math.max(8, top)}px`;
  popover.style.left = `${Math.max(8, left)}px`;
}

function previewScale(width) {
  return Math.max(2, Math.min(4, Math.round(360 / Math.max(width, 1))));
}

function drawTemplatePreview(canvas, image, part) {
  const scale = previewScale(image.naturalWidth);
  canvas.width = image.naturalWidth * scale;
  canvas.height = image.naturalHeight * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (!part) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    part.x, part.y, part.width, part.height,
    part.x * scale, part.y * scale, part.width * scale, part.height * scale,
  );
  ctx.strokeStyle = '#4fc1ff';
  ctx.lineWidth = Math.max(2, scale);
  ctx.strokeRect(
    part.x * scale + 0.5,
    part.y * scale + 0.5,
    part.width * scale - 1,
    part.height * scale - 1,
  );
}

function bindTemplatePreview(editor, getScreen) {
  const popover = document.getElementById('popover');
  const canvas = popover.querySelector('canvas');
  const caption = popover.querySelector('.caption');
  const loaded = new Map();
  let hideTimer = 0;

  function hide() {
    popover.hidden = true;
  }

  function loadImage(url) {
    if (loaded.has(url)) return loaded.get(url);
    const pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('missing'));
      image.src = url;
    });
    loaded.set(url, pending);
    return pending;
  }

  async function show(anchor) {
    const screen = getScreen();
    const filename = anchor.dataset.template;
    if (!screen || !filename) return;
    clearTimeout(hideTimer);
    const part = anchor.dataset.part
      ? {
        name: anchor.dataset.part,
        x: Number(anchor.dataset.x),
        y: Number(anchor.dataset.y),
        width: Number(anchor.dataset.width),
        height: Number(anchor.dataset.height),
      }
      : null;
    caption.textContent = part
      ? `${part.name} on ${filename}`
      : filename;
    popover.hidden = false;
    placePopover(anchor, popover);
    try {
      const image = await loadImage(`/screens/${encodeURIComponent(screen)}/templates/${encodeURIComponent(filename)}`);
      if (!anchor.isConnected) return;
      drawTemplatePreview(canvas, image, part);
      caption.textContent = part
        ? `${part.name} · ${part.width}×${part.height} at ${part.x},${part.y}`
        : `${filename} · ${image.naturalWidth}×${image.naturalHeight}`;
      placePopover(anchor, popover);
    } catch {
      caption.textContent = `${filename} · missing`;
      placePopover(anchor, popover);
    }
  }

  editor.addEventListener('mouseover', (event) => {
    const anchor = event.target.closest('.tpl');
    if (anchor) show(anchor);
  });
  editor.addEventListener('mouseout', (event) => {
    const from = event.target.closest('.tpl');
    const to = event.relatedTarget && event.relatedTarget.closest?.('.tpl');
    if (from && from !== to) hideTimer = setTimeout(hide, 80);
  });
}

async function openIde() {
  const tabs = document.getElementById('tabs');
  const editor = document.getElementById('editor');
  const statusFile = document.getElementById('status-file');
  const statusLines = document.getElementById('status-lines');
  const navConfig = document.getElementById('nav-config');
  const navTest = document.getElementById('nav-test');
  const cache = new Map();

  let FILES;
  try {
    const sourceRes = await fetch('/api/sources');
    const sourceBody = await sourceRes.json();
    FILES = sourceBody.files || [];
  } catch (err) {
    editor.innerHTML = `<div class="error">${escapeHtml(String(err.message || err))}</div>`;
    return;
  }
  if (!FILES.length) {
    editor.innerHTML = `<div class="error">No source files found.</div>`;
    return;
  }

  let current = FILES[0];

  bindTemplatePreview(editor, () => current.screen);

  async function show(fileKey, push) {
    const item = FILES.find((file) => file.file === fileKey) || FILES[0];
    current = item;
    for (const button of tabs.querySelectorAll('button')) {
      button.classList.toggle('active', button.dataset.file === item.file);
    }
    navConfig?.classList.toggle('current', Boolean(item.screen));
    navTest?.classList.toggle('current', item.file === 'test');
    editor.innerHTML = `<div class="row"><span class="ln"></span><span class="line">Loading…</span></div>`;
    try {
      if (!cache.has(item.file)) cache.set(item.file, await fetchSource(item.file));
      const body = cache.get(item.file);
      editor.innerHTML = renderCode(body.source);
      statusFile.textContent = item.path;
      statusLines.textContent = `${body.source.split('\n').length} lines · TypeScript · UTF-8`;
      document.title = item.tab;
      const url = `${location.pathname}?file=${encodeURIComponent(item.file)}`;
      if (push) history.pushState({ file: item.file }, '', url);
      else history.replaceState({ file: item.file }, '', url);
    } catch (err) {
      editor.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
    }
  }

  tabs.innerHTML = FILES.map((file) =>
    `<button type="button" data-file="${file.file}">${escapeHtml(file.tab)}</button>`
  ).join('');
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) show(button.dataset.file, true);
  });
  window.addEventListener('popstate', () => {
    show(new URLSearchParams(location.search).get('file') || FILES[0].file, false);
  });
  show(new URLSearchParams(location.search).get('file') || FILES[0].file, false);
}

window.openIde = openIde;
