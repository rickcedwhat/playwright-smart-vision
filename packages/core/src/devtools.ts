import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { getGlobalConfig, loadScreen, writeScreenBuffer } from './configure.js';
import { FieldExtractor } from './field-extractor.js';
import { screenDir } from './author/storage.js';
import { ensureCvReady } from './utils/vision.js';
import { getOCRUtil } from './utils/ocr.js';

type ScreenListItem = { name: string; hasIndex: boolean };

export type OverlayHit = {
  name: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  parts?: Array<{ name: string; x: number; y: number; width: number; height: number }>;
};

/** First document-capture listener: type into the name field before Guacamole can steal keys. */
const DEVTOOLS_KEYS = `(function () {
  if (window.__ocrNameInputShield) return;
  window.__ocrNameInputShield = true;

  document.addEventListener('keydown', (e) => {
    const input = document.getElementById('__ocr-name-input');
    if (input && e.target === input) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      if (e.key.length === 1) {
        input.value = input.value.slice(0, start) + e.key + input.value.slice(end);
        input.setSelectionRange(start + 1, start + 1);
      } else if (e.key === 'Backspace') {
        if (start !== end) {
          input.value = input.value.slice(0, start) + input.value.slice(end);
          input.setSelectionRange(start, start);
        } else if (start > 0) {
          input.value = input.value.slice(0, start - 1) + input.value.slice(end);
          input.setSelectionRange(start - 1, start - 1);
        }
      } else if (e.key === 'Enter') {
        document.getElementById('__ocr-modal-save')?.click();
      } else if (e.key === 'Escape') {
        document.getElementById('__ocr-modal-backdrop')?.remove();
      } else {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (document.getElementById('__ocr-library-backdrop')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.__ocrLibraryKey && window.__ocrLibraryKey(e.key);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (document.getElementById('__ocr-inspect-overlay')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.__ocrHideInspect && window.__ocrHideInspect();
        return;
      }
      const fab = document.getElementById('__ocr-fab');
      if (fab && fab.classList.contains('open')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        fab.classList.remove('open');
      }
    }
  }, true);
})();`;

const FAB_SCRIPT = `(function () {
  if (window.__ocrDevtools) return;
  window.__ocrDevtools = true;

  function init() {
    if (document.getElementById('__ocr-fab')) return;

    const style = document.createElement('style');
    style.textContent = \`
      #__ocr-fab {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: system-ui, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
      #__ocr-fab-btn, #__ocr-fab-actions button {
        width: 48px;
        height: 48px;
        min-width: 48px;
        min-height: 48px;
        padding: 0;
        margin: 0;
        box-sizing: border-box;
        border-radius: 50%;
        background: #1a1a2e;
        border: 2px solid #4f46e5;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        appearance: none;
        -webkit-appearance: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }
      #__ocr-fab-btn { font-size: 26px; line-height: 1; transition: transform 0.2s; }
      #__ocr-fab.open #__ocr-fab-btn { transform: rotate(45deg); }
      #__ocr-fab-actions {
        display: none;
        flex-direction: column;
        gap: 10px;
      }
      #__ocr-fab.open #__ocr-fab-actions { display: flex; }
      #__ocr-fab-actions button { width: 40px; height: 40px; min-width: 40px; min-height: 40px; }
      #__ocr-fab-actions button:hover { filter: brightness(1.15); }
      #__ocr-fab-actions button:disabled { opacity: 0.35; cursor: not-allowed; filter: none; }
      #__ocr-fab-overlay.on { background: #3d6d3d; border-color: #5a9; }
      #__ocr-fab-chip {
        position: absolute;
        right: 56px;
        bottom: 12px;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: #1a1a2e;
        color: #cfc;
        border: 1px solid #4f46e5;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        pointer-events: none;
      }
      #__ocr-fab-chip[hidden] { display: none; }
      #__ocr-modal-backdrop, #__ocr-library-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.6);
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, sans-serif;
      }
      #__ocr-modal, #__ocr-library {
        background: #1a1a2e;
        border: 1px solid #4f46e5;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        font-family: system-ui, sans-serif;
        line-height: normal;
        color: #e2e8f0;
      }
      #__ocr-modal { width: 480px; max-width: 90vw; }
      #__ocr-library { width: min(860px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
      #__ocr-modal h3, #__ocr-library h3 { margin: 0 0 12px; color: #e2e8f0; font-size: 15px; }
      #__ocr-modal img { width: 100%; border-radius: 6px; border: 1px solid #4f46e5; margin-bottom: 12px; }
      #__ocr-modal input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid #4f46e5;
        background: #0f0f1a;
        color: #e2e8f0;
        font-size: 13px;
        margin-bottom: 12px;
        outline: none;
        pointer-events: auto;
        user-select: text;
        -webkit-user-select: text;
      }
      #__ocr-modal input:focus { border-color: #818cf8; }
      #__ocr-modal-actions, #__ocr-library-actions { display: flex; gap: 8px; justify-content: flex-end; }
      #__ocr-modal-actions button, #__ocr-library-actions button {
        padding: 7px 16px; border-radius: 6px; border: none; font-size: 13px; cursor: pointer;
      }
      #__ocr-modal-save, #__ocr-library-choose { background: #4f46e5; color: #fff; }
      #__ocr-modal-save:hover, #__ocr-library-choose:hover { background: #6366f1; }
      #__ocr-modal-save:disabled, #__ocr-library-choose:disabled { opacity: 0.5; cursor: default; }
      #__ocr-modal-cancel, #__ocr-library-cancel { background: #2d2d4e; color: #e2e8f0; }
      #__ocr-library-body { display: grid; grid-template-columns: 220px 1fr; gap: 12px; min-height: 280px; margin-bottom: 12px; }
      #__ocr-library-list {
        overflow: auto;
        max-height: 52vh;
        border: 1px solid #333;
        border-radius: 8px;
        background: #111;
      }
      #__ocr-library-list button {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        border-bottom: 1px solid #2a2a2a;
        color: #ddd;
        padding: 8px 10px;
        cursor: pointer;
        font: 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #__ocr-library-list button:hover { background: #2a2a2a; }
      #__ocr-library-list button.active { background: #243a24; color: #cfc; }
      #__ocr-library-list .muted { color: #888; font-size: 11px; }
      #__ocr-library-preview {
        background: #000;
        border: 1px solid #333;
        border-radius: 8px;
        min-height: 220px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      #__ocr-library-preview img { max-width: 100%; max-height: 52vh; display: block; }
      #__ocr-library-empty { color: #888; padding: 16px; font-size: 13px; }
      #__ocr-toast {
        position: fixed;
        bottom: 80px;
        right: 20px;
        z-index: 2147483647;
        background: #16a34a;
        color: #fff;
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-family: system-ui, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        transition: opacity 0.3s;
      }
      #__ocr-toast.err { background: #4a2020; color: #fcc; }
      #__ocr-inspect-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        pointer-events: auto;
      }
      #__ocr-inspect-overlay .hit {
        position: absolute;
        border: 2px solid #6af;
        background: rgba(80,160,255,.12);
        box-sizing: border-box;
        cursor: pointer;
      }
      #__ocr-inspect-overlay .hit.low { border-color: #f66; background: rgba(255,80,80,.12); }
      #__ocr-inspect-overlay .hit.on { outline: 2px solid #ffe08a; z-index: 2; }
      #__ocr-inspect-overlay .part {
        position: absolute;
        border: 1px dashed #9cf;
        pointer-events: none;
      }
      #__ocr-inspect-pop {
        position: absolute;
        z-index: 3;
        width: min(280px, 90vw);
        background: #1c1c1c;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 10px;
        color: #ddd;
        font: 12px/1.35 system-ui, sans-serif;
        pointer-events: none;
      }
      #__ocr-inspect-pop b { display: block; margin-bottom: 4px; color: #fff; }
    \`;
    (document.head || document.documentElement).appendChild(style);

    const fab = document.createElement('div');
    fab.id = '__ocr-fab';
    fab.innerHTML = \`
      <div id="__ocr-fab-actions">
        <button id="__ocr-fab-overlay" type="button" disabled title="Choose a screen first">&#9638;</button>
        <button id="__ocr-fab-library" type="button" title="Choose screen">&#9776;</button>
        <button id="__ocr-fab-capture" type="button" title="Capture screen">&#128065;</button>
      </div>
      <button id="__ocr-fab-btn" title="smart-vision" aria-expanded="false">+</button>
      <div id="__ocr-fab-chip" hidden></div>
    \`;

    function isolateFromPage(el) {
      const types = ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'input', 'pointerdown', 'pointerup', 'compositionstart', 'compositionupdate', 'compositionend'];
      for (const type of types) {
        el.addEventListener(type, (e) => e.stopPropagation());
      }
    }

    isolateFromPage(fab);
    (document.body || document.documentElement).appendChild(fab);

    const fabBtn = fab.querySelector('#__ocr-fab-btn');
    const captureBtn = fab.querySelector('#__ocr-fab-capture');
    const libraryBtn = fab.querySelector('#__ocr-fab-library');
    const overlayBtn = fab.querySelector('#__ocr-fab-overlay');
    const chip = fab.querySelector('#__ocr-fab-chip');
    let currentScreen = '';
    let currentHasIndex = false;
    let overlayOn = false;
    let hoverTimer = 0;

    let openedByHover = false;

    function setOpen(open) {
      fab.classList.toggle('open', open);
      fabBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) openedByHover = false;
    }

    fabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openedByHover && fab.classList.contains('open')) {
        openedByHover = false;
        return;
      }
      setOpen(!fab.classList.contains('open'));
    });
    fab.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
      openedByHover = true;
      setOpen(true);
    });

    function syncOverlayBtn() {
      overlayBtn.disabled = !currentHasIndex;
      overlayBtn.title = currentHasIndex
        ? (overlayOn ? 'Hide overlay' : 'Show overlay')
        : (currentScreen ? 'Apply this screen in TM v2 first' : 'Choose a screen first');
      overlayBtn.classList.toggle('on', overlayOn);
    }

    function setCurrent(name, hasIndex) {
      currentScreen = name || '';
      currentHasIndex = !!hasIndex;
      chip.hidden = !currentScreen;
      chip.textContent = currentScreen;
      if (overlayOn && !currentHasIndex) hideInspect();
      syncOverlayBtn();
    }

    fab.addEventListener('mouseleave', () => {
      hoverTimer = setTimeout(() => setOpen(false), 280);
    });
    document.addEventListener('mousedown', (e) => {
      if (!fab.classList.contains('open')) return;
      if (fab.contains(e.target)) return;
      if (document.getElementById('__ocr-modal-backdrop')) return;
      if (document.getElementById('__ocr-library-backdrop')) return;
      setOpen(false);
    }, true);

    captureBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      setOpen(false);
      const overlayEl = document.getElementById('__ocr-inspect-overlay');
      if (overlayEl) overlayEl.style.visibility = 'hidden';
      fab.style.visibility = 'hidden';
      let b64;
      try {
        b64 = await window.__ocrCapture();
      } finally {
        fab.style.visibility = '';
        if (overlayEl) overlayEl.style.visibility = '';
      }
      showCaptureModal(b64);
    });

    libraryBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      setOpen(false);
      await showLibraryModal();
    });

    overlayBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (overlayBtn.disabled) return;
      if (overlayOn) {
        hideInspect();
        return;
      }
      setOpen(false);
      overlayBtn.disabled = true;
      overlayBtn.title = 'Matching…';
      fab.style.visibility = 'hidden';
      try {
        const hits = await window.__ocrMatchOverlay(currentScreen);
        showInspect(hits);
        showToast('Overlay: ' + currentScreen);
      } catch (err) {
        showToast('Overlay failed: ' + (err && err.message ? err.message : err), true);
      } finally {
        fab.style.visibility = '';
        syncOverlayBtn();
      }
    });

    function showToast(msg, err) {
      document.getElementById('__ocr-toast')?.remove();
      const t = document.createElement('div');
      t.id = '__ocr-toast';
      if (err) t.className = 'err';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
    }

    function showCaptureModal(b64) {
      const backdrop = document.createElement('div');
      backdrop.id = '__ocr-modal-backdrop';
      backdrop.innerHTML = \`
        <div id="__ocr-modal">
          <h3>Captured Screen</h3>
          <img src="data:image/png;base64,\${b64}" />
          <input id="__ocr-name-input" type="text" placeholder="Screen name (e.g. desktop, customer-info)" />
          <div id="__ocr-modal-actions">
            <button id="__ocr-modal-cancel" type="button">Cancel</button>
            <button id="__ocr-modal-save" type="button">Save</button>
          </div>
        </div>
      \`;
      document.body.appendChild(backdrop);
      const modal = backdrop.querySelector('#__ocr-modal');
      const input = backdrop.querySelector('#__ocr-name-input');
      const saveBtn = backdrop.querySelector('#__ocr-modal-save');
      isolateFromPage(backdrop);
      isolateFromPage(modal);
      isolateFromPage(input);
      input.focus();
      backdrop.querySelector('#__ocr-modal-cancel').addEventListener('click', () => backdrop.remove());
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
      saveBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          await window.__ocrSave(name, b64);
          backdrop.remove();
          let hasIndex = false;
          try {
            const listed = await window.__ocrListScreens();
            const row = (listed || []).find((s) => s.name === name);
            hasIndex = !!(row && row.hasIndex);
          } catch (_) {}
          setCurrent(name, hasIndex);
          showToast('Saved: ' + name);
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          alert('Save failed: ' + err.message);
        }
      });
    }

    async function showLibraryModal() {
      let screens = [];
      try {
        screens = await window.__ocrListScreens() || [];
      } catch (err) {
        showToast('Could not list screens: ' + (err && err.message ? err.message : err), true);
        return;
      }
      const backdrop = document.createElement('div');
      backdrop.id = '__ocr-library-backdrop';
      const names = screens.map((s) => s.name);
      let selected = currentScreen && names.includes(currentScreen) ? currentScreen : (names[0] || '');
      backdrop.innerHTML = \`
        <div id="__ocr-library">
          <h3>Choose current screen</h3>
          <div id="__ocr-library-body">
            <div id="__ocr-library-list"></div>
            <div id="__ocr-library-preview"><span class="muted">No preview</span></div>
          </div>
          <div id="__ocr-library-actions">
            <button id="__ocr-library-cancel" type="button">Cancel</button>
            <button id="__ocr-library-choose" type="button">Choose current screen</button>
          </div>
        </div>
      \`;
      document.body.appendChild(backdrop);
      isolateFromPage(backdrop);
      isolateFromPage(backdrop.querySelector('#__ocr-library'));
      const listEl = backdrop.querySelector('#__ocr-library-list');
      const previewEl = backdrop.querySelector('#__ocr-library-preview');
      const chooseBtn = backdrop.querySelector('#__ocr-library-choose');
      chooseBtn.disabled = !screens.length;

      function renderList() {
        if (!screens.length) {
          listEl.innerHTML = '<div id="__ocr-library-empty">No screens in the local cache yet. Capture one first.</div>';
          return;
        }
        listEl.innerHTML = screens.map((s) => (
          '<button type="button" data-name="' + s.name + '" class="' + (s.name === selected ? 'active' : '') + '">' +
          s.name +
          (s.hasIndex ? '' : '<div class="muted">capture only</div>') +
          '</button>'
        )).join('');
      }

      async function showPreview(name) {
        selected = name;
        renderList();
        previewEl.innerHTML = '<span class="muted">Loading…</span>';
        try {
          const b64 = await window.__ocrScreenPreview(name);
          if (!b64) {
            previewEl.innerHTML = '<span class="muted">No blank.png</span>';
            return;
          }
          previewEl.innerHTML = '<img alt="' + name + '" src="data:image/png;base64,' + b64 + '">';
        } catch (err) {
          previewEl.innerHTML = '<span class="muted">' + (err && err.message ? err.message : 'preview failed') + '</span>';
        }
      }

      listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-name]');
        if (btn) showPreview(btn.dataset.name);
      });

      window.__ocrLibraryKey = (key) => {
        if (key === 'Escape') {
          backdrop.remove();
          return;
        }
        if (!screens.length) return;
        const idx = Math.max(0, names.indexOf(selected));
        if (key === 'ArrowDown') showPreview(names[Math.min(names.length - 1, idx + 1)]);
        if (key === 'ArrowUp') showPreview(names[Math.max(0, idx - 1)]);
        if (key === 'Enter') chooseBtn.click();
      };

      backdrop.querySelector('#__ocr-library-cancel').addEventListener('click', () => backdrop.remove());
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
      chooseBtn.addEventListener('click', () => {
        if (!selected) return;
        const row = screens.find((s) => s.name === selected);
        setCurrent(selected, !!(row && row.hasIndex));
        backdrop.remove();
        showToast('Current screen: ' + selected);
      });

      if (selected) showPreview(selected);
      else renderList();
    }

    function hideInspect() {
      overlayOn = false;
      document.getElementById('__ocr-inspect-overlay')?.remove();
      syncOverlayBtn();
    }
    window.__ocrHideInspect = hideInspect;

    function showInspect(hits) {
      hideInspect();
      overlayOn = true;
      const root = document.createElement('div');
      root.id = '__ocr-inspect-overlay';
      const dpr = window.devicePixelRatio || 1;
      const shield = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu', 'wheel']) {
        root.addEventListener(type, shield, true);
      }
      let pinned = '';
      const pop = document.createElement('div');
      pop.id = '__ocr-inspect-pop';
      pop.hidden = true;
      root.appendChild(pop);

      const sorted = (hits || []).slice().sort((a, b) => (a.width * a.height) - (b.width * b.height));
      for (const hit of sorted) {
        const el = document.createElement('div');
        el.className = 'hit' + ((hit.confidence || 0) < 0.7 ? ' low' : '');
        el.dataset.name = hit.name;
        el.style.left = (hit.x / dpr) + 'px';
        el.style.top = (hit.y / dpr) + 'px';
        el.style.width = (hit.width / dpr) + 'px';
        el.style.height = (hit.height / dpr) + 'px';
        for (const part of hit.parts || []) {
          const p = document.createElement('div');
          p.className = 'part';
          p.style.left = ((part.x - hit.x) / dpr) + 'px';
          p.style.top = ((part.y - hit.y) / dpr) + 'px';
          p.style.width = (part.width / dpr) + 'px';
          p.style.height = (part.height / dpr) + 'px';
          el.appendChild(p);
        }
        el.addEventListener('pointerover', (e) => {
          e.stopPropagation();
          if (!pinned) showPop(hit, el);
        });
        el.addEventListener('pointerout', (e) => {
          if (!pinned && !el.contains(e.relatedTarget)) pop.hidden = true;
        });
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pinned = pinned === hit.name ? '' : hit.name;
          root.querySelectorAll('.hit').forEach((node) => node.classList.toggle('on', node.dataset.name === pinned));
          if (pinned) showPop(hit, el);
          else pop.hidden = true;
        });
        root.appendChild(el);
      }
      root.addEventListener('click', (e) => {
        if (e.target === root) {
          pinned = '';
          pop.hidden = true;
          root.querySelectorAll('.hit').forEach((node) => node.classList.remove('on'));
        }
      });
      function showPop(hit, el) {
        pop.hidden = false;
        const conf = hit.confidence == null ? '' : ' · ' + Math.round(hit.confidence * 100) + '%';
        const parts = (hit.parts || []).map((p) => p.name).join(', ');
        pop.innerHTML = '<b>' + hit.name + '</b>' +
          (hit.type || 'element') + conf +
          (parts ? '<div>' + parts + '</div>' : '');
        const r = el.getBoundingClientRect();
        let left = r.right + 8;
        let top = r.top;
        if (left + 280 > window.innerWidth) left = Math.max(8, r.left - 288);
        if (top + 80 > window.innerHeight) top = Math.max(8, window.innerHeight - 90);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
      }
      document.documentElement.appendChild(root);
      syncOverlayBtn();
    }

    syncOverlayBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;

function listDevtoolsScreens(): ScreenListItem[] {
  const root = getGlobalConfig().storage?.root;
  if (!root || !fs.existsSync(root)) return [];
  const out: ScreenListItem[] = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const dir = path.join(root, ent.name);
    if (!fs.existsSync(path.join(dir, 'blank.png'))) continue;
    out.push({
      name: ent.name,
      hasIndex: fs.existsSync(path.join(dir, 'index.json')),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function matchOverlay(page: Page, name: string): Promise<OverlayHit[]> {
  const screen = loadScreen(name);
  const shot = await page.screenshot({ timeout: 8_000 });
  const tmp = path.join(os.tmpdir(), `ocr-fab-overlay-${Date.now()}.png`);
  fs.writeFileSync(tmp, shot);
  await ensureCvReady();
  const ocr = await getOCRUtil();
  const extractor = new FieldExtractor(ocr, false);
  try {
    await extractor.loadForms(screen.blankScreenPath, tmp);
    const comparison = await extractor.extractElements(screen.elementConfigs, { locateOnly: true });
    return comparison.elements.map((el) => {
      const hit: OverlayHit = {
        name: el.name,
        x: el.location.x,
        y: el.location.y,
        width: el.location.width,
        height: el.location.height,
        confidence: el.confidence ?? 0,
      };
      if (el.type) hit.type = String(el.type);
      if (el.parts?.length) {
        hit.parts = el.parts.map((part) => ({
          name: part.name,
          x: part.location.x,
          y: part.location.y,
          width: part.location.width,
          height: part.location.height,
        }));
      }
      return hit;
    });
  } finally {
    extractor.cleanup();
    fs.rmSync(tmp, { force: true });
  }
}

async function expose(page: Page, name: string, fn: (...args: never[]) => unknown): Promise<void> {
  try {
    await page.exposeFunction(name, fn as never);
  } catch (err) {
    if (!String(err).includes('already')) throw err;
  }
}

export async function injectDevtools(page: Page): Promise<void> {
  await expose(page, '__ocrCapture', async (): Promise<string> => {
    const buffer = await page.screenshot({ timeout: 5_000 });
    return buffer.toString('base64');
  });

  await expose(page, '__ocrSave', async (name: string, b64: string): Promise<void> => {
    writeScreenBuffer(name, Buffer.from(b64, 'base64'));
  });

  await expose(page, '__ocrListScreens', async (): Promise<ScreenListItem[]> => listDevtoolsScreens());

  await expose(page, '__ocrScreenPreview', async (name: string): Promise<string | null> => {
    const blankPath = path.join(screenDir(name), 'blank.png');
    if (!fs.existsSync(blankPath)) return null;
    return fs.readFileSync(blankPath).toString('base64');
  });

  await expose(page, '__ocrMatchOverlay', async (name: string): Promise<OverlayHit[]> => matchOverlay(page, name));

  await page.addInitScript(DEVTOOLS_KEYS);
  await page.addInitScript(FAB_SCRIPT);
  await page.evaluate(DEVTOOLS_KEYS);
  await page.evaluate(FAB_SCRIPT);
}
