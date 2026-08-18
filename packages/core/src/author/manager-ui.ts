/** Minimal in-flow template inspector. Served by runManager(). */
export const MANAGER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>smart-vision manager</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #111; color: #eee; display: flex; height: 100vh; }
  aside { width: 320px; flex-shrink: 0; overflow: auto; padding: 12px; background: #1b1b1b; border-right: 1px solid #333; }
  main { flex: 1; overflow: auto; position: relative; background: #000; }
  h1 { font-size: 14px; margin: 0 0 8px; }
  select, button, input { font: inherit; }
  button, select { background: #333; color: #eee; border: 1px solid #555; padding: 6px 10px; border-radius: 4px; cursor: pointer; }
  button.primary { background: #3d6d3d; border-color: #5a9; }
  button:hover { filter: brightness(1.15); }
  .row { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .el { border: 1px solid #333; padding: 8px; margin-bottom: 8px; border-radius: 4px; }
  .el.active { border-color: #6af; }
  .el h3 { margin: 0 0 6px; font-size: 13px; }
  label { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; }
  label input { width: 88px; background: #222; color: #eee; border: 1px solid #444; padding: 2px 4px; }
  .stage { position: relative; display: inline-block; }
  .stage img { display: block; max-width: 100%; height: auto; }
  .box { position: absolute; border: 2px solid #f44; pointer-events: none; }
  .el-box { position: absolute; border: 2px solid #6af; background: rgba(80,160,255,.12); }
  .el-box.active { border-color: #8f8; background: rgba(80,255,120,.18); }
  .status { color: #8c8; min-height: 1.2em; margin: 8px 0; }
  .muted { color: #888; }
</style>
</head>
<body>
<aside>
  <h1>smart-vision manager</h1>
  <div class="row">
    <select id="screen"></select>
    <button id="reload" type="button">Reload</button>
  </div>
  <label class="muted"><input type="checkbox" id="showDetected" checked> detected boxes</label>
  <p class="status" id="status"></p>
  <div class="row">
    <button class="primary" id="save" type="button">Save</button>
    <button id="done" type="button">Done</button>
  </div>
  <div id="list"></div>
</aside>
<main>
  <div class="stage" id="stage">
    <img id="blank" alt="blank screen">
    <div id="overlays"></div>
  </div>
</main>
<script>
const screenSel = document.getElementById('screen');
const list = document.getElementById('list');
const status = document.getElementById('status');
const blank = document.getElementById('blank');
const overlays = document.getElementById('overlays');
const showDetected = document.getElementById('showDetected');
let state = { name: '', elements: [], boxes: [], natW: 1, natH: 1 };
let selected = '';

function qs(name) { return new URLSearchParams(location.search).get(name) || ''; }

async function loadScreens() {
  const names = await (await fetch('/api/screens')).json();
  const current = qs('screen') || names[0] || '';
  screenSel.innerHTML = names.map((n) => '<option' + (n === current ? ' selected' : '') + '>' + n + '</option>').join('');
  if (current) await loadScreen(current);
}

async function loadScreen(name) {
  selected = '';
  const data = await (await fetch('/api/screen?name=' + encodeURIComponent(name))).json();
  state = { name, elements: data.elements || [], boxes: data.boxes || [], natW: data.width || 1, natH: data.height || 1 };
  blank.src = '/file/blank?name=' + encodeURIComponent(name) + '&t=' + Date.now();
  renderList();
  status.textContent = name;
}

function renderList() {
  list.innerHTML = state.elements.map((el) => {
    const active = el.name === selected ? ' active' : '';
    return '<div class="el' + active + '" data-name="' + el.name + '"><h3>' + el.name + '</h3>' +
      '<label>x <input data-k="x" type="number" value="' + el.x + '"></label>' +
      '<label>y <input data-k="y" type="number" value="' + el.y + '"></label>' +
      '<label>w <input data-k="width" type="number" value="' + el.width + '"></label>' +
      '<label>h <input data-k="height" type="number" value="' + el.height + '"></label></div>';
  }).join('') || '<p class="muted">No index.json elements. Run apply first, or inspect detected boxes.</p>';
  paint();
}

function paint() {
  const scaleX = blank.clientWidth / (blank.naturalWidth || state.natW || 1);
  const scaleY = blank.clientHeight / (blank.naturalHeight || state.natH || 1);
  let html = '';
  if (showDetected.checked) {
    for (const box of state.boxes) {
      html += '<div class="box" style="left:' + (box.x * scaleX) + 'px;top:' + (box.y * scaleY) + 'px;width:' + (box.width * scaleX) + 'px;height:' + (box.height * scaleY) + 'px"></div>';
    }
  }
  for (const el of state.elements) {
    const active = el.name === selected ? ' active' : '';
    html += '<div class="el-box' + active + '" data-name="' + el.name + '" style="left:' + (el.x * scaleX) + 'px;top:' + (el.y * scaleY) + 'px;width:' + (el.width * scaleX) + 'px;height:' + (el.height * scaleY) + 'px"></div>';
  }
  overlays.innerHTML = html;
}

blank.addEventListener('load', paint);
window.addEventListener('resize', paint);
showDetected.addEventListener('change', paint);

screenSel.addEventListener('change', () => loadScreen(screenSel.value));
document.getElementById('reload').addEventListener('click', () => loadScreen(screenSel.value));

list.addEventListener('input', (e) => {
  const input = e.target;
  if (input.tagName !== 'INPUT') return;
  const wrap = input.closest('.el');
  const el = state.elements.find((x) => x.name === wrap.dataset.name);
  if (!el) return;
  el[input.dataset.k] = Number(input.value);
  selected = el.name;
  renderList();
});
list.addEventListener('click', (e) => {
  const wrap = e.target.closest('.el');
  if (!wrap) return;
  selected = wrap.dataset.name;
  renderList();
});

document.getElementById('save').addEventListener('click', async () => {
  const res = await fetch('/api/screen?name=' + encodeURIComponent(state.name), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ elements: state.elements }),
  });
  const body = await res.json();
  status.textContent = res.ok ? 'saved ' + (body.saved || state.name) : (body.error || 'save failed');
});

document.getElementById('done').addEventListener('click', () => {
  window.__smartVisionDone = true;
});

loadScreens();
</script>
</body>
</html>
`;
