import type { Page } from '@playwright/test';
import { writeScreenBuffer } from './configure.js';

const FAB_SCRIPT = `(function () {
  if (window.__ocrDevtools) return;
  window.__ocrDevtools = true;

  const style = document.createElement('style');
  style.textContent = \`
    #__ocr-fab {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: system-ui, sans-serif;
    }
    #__ocr-fab-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #1a1a2e;
      border: 2px solid #4f46e5;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: transform 0.15s;
    }
    #__ocr-fab-btn:hover { transform: scale(1.1); }
    #__ocr-fab-menu {
      position: absolute;
      bottom: 56px;
      right: 0;
      background: #1a1a2e;
      border: 1px solid #4f46e5;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      display: none;
    }
    #__ocr-fab-menu.open { display: block; }
    #__ocr-fab-menu button {
      display: block;
      width: 100%;
      padding: 10px 16px;
      background: none;
      border: none;
      color: #e2e8f0;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      text-align: left;
    }
    #__ocr-fab-menu button:hover { background: #2d2d4e; }
    #__ocr-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #__ocr-modal {
      background: #1a1a2e;
      border: 1px solid #4f46e5;
      border-radius: 12px;
      padding: 20px;
      width: 480px;
      max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      font-family: system-ui, sans-serif;
    }
    #__ocr-modal h3 {
      margin: 0 0 12px;
      color: #e2e8f0;
      font-size: 15px;
    }
    #__ocr-modal img {
      width: 100%;
      border-radius: 6px;
      border: 1px solid #4f46e5;
      margin-bottom: 12px;
    }
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
    }
    #__ocr-modal input:focus { border-color: #818cf8; }
    #__ocr-modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    #__ocr-modal-actions button {
      padding: 7px 16px;
      border-radius: 6px;
      border: none;
      font-size: 13px;
      cursor: pointer;
    }
    #__ocr-modal-save {
      background: #4f46e5;
      color: #fff;
    }
    #__ocr-modal-save:hover { background: #6366f1; }
    #__ocr-modal-save:disabled { opacity: 0.5; cursor: default; }
    #__ocr-modal-cancel {
      background: #2d2d4e;
      color: #e2e8f0;
    }
    #__ocr-modal-cancel:hover { background: #3d3d5e; }
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
  \`;
  document.head.appendChild(style);

  const fab = document.createElement('div');
  fab.id = '__ocr-fab';
  fab.innerHTML = \`
    <div id="__ocr-fab-menu">
      <button id="__ocr-capture-btn">📷 Capture Screen</button>
    </div>
    <button id="__ocr-fab-btn" title="OCR Devtools">👁</button>
  \`;
  document.body.appendChild(fab);

  const fabBtn = document.getElementById('__ocr-fab-btn');
  const menu = document.getElementById('__ocr-fab-menu');
  const captureBtn = document.getElementById('__ocr-capture-btn');

  fabBtn.addEventListener('click', () => menu.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!fab.contains(e.target)) menu.classList.remove('open');
  });

  captureBtn.addEventListener('click', async () => {
    menu.classList.remove('open');
    fab.style.display = 'none';
    let b64;
    try {
      b64 = await window.__ocrCapture();
    } finally {
      fab.style.display = '';
    }
    showModal(b64);
  });

  function showModal(b64) {
    const backdrop = document.createElement('div');
    backdrop.id = '__ocr-modal-backdrop';
    backdrop.innerHTML = \`
      <div id="__ocr-modal">
        <h3>Captured Screen</h3>
        <img src="data:image/png;base64,\${b64}" />
        <input id="__ocr-name-input" type="text" placeholder="Screen name (e.g. desktop, customer-info)" />
        <div id="__ocr-modal-actions">
          <button id="__ocr-modal-cancel">Cancel</button>
          <button id="__ocr-modal-save">Save</button>
        </div>
      </div>
    \`;
    document.body.appendChild(backdrop);

    const input = document.getElementById('__ocr-name-input');
    const saveBtn = document.getElementById('__ocr-modal-save');
    const cancelBtn = document.getElementById('__ocr-modal-cancel');

    input.focus();

    cancelBtn.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    saveBtn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await window.__ocrSave(name, b64);
        backdrop.remove();
        showToast('Saved: ' + name);
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        alert('Save failed: ' + err.message);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') backdrop.remove();
    });
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.id = '__ocr-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
  }
})();`;

export async function injectDevtools(page: Page): Promise<void> {
  await page.exposeFunction('__ocrCapture', async (): Promise<string> => {
    const buffer = await page.screenshot({ timeout: 5_000 });
    return buffer.toString('base64');
  });

  await page.exposeFunction('__ocrSave', async (name: string, b64: string): Promise<void> => {
    writeScreenBuffer(name, Buffer.from(b64, 'base64'));
  });

  await page.addInitScript(FAB_SCRIPT);
}
