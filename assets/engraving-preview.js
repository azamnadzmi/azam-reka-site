/* assets/engraving-preview.js
   Live engraving preview widget — injected on product detail pages.
   Draws engraving text over the product image using HTML Canvas.
   Supports Latin and Arabic/Jawi (RTL) text.
*/

(function () {
  'use strict';

  const FONTS = [
    { key: 'serif',      label: 'Classic Serif',   css: 'Georgia, serif',                      google: null },
    { key: 'elegant',   label: 'Elegant Script',   css: '"Dancing Script", cursive',            google: 'Dancing+Script:wght@600' },
    { key: 'modern',    label: 'Modern Sans',       css: '"Montserrat", sans-serif',             google: 'Montserrat:wght@400;600' },
    { key: 'typewriter',label: 'Typewriter',        css: '"Courier Prime", monospace',           google: 'Courier+Prime:wght@400' },
    { key: 'arabic',    label: 'Jawi / Arabic',     css: '"Scheherazade New", serif',            google: 'Scheherazade+New:wght@400;600' },
  ];

  let fontsLoaded = false;

  function loadGoogleFonts() {
    if (fontsLoaded) return;
    fontsLoaded = true;
    const families = FONTS
      .filter(f => f.google)
      .map(f => `family=${f.google}`)
      .join('&');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }

  function buildWidget(section) {
    const img = section.querySelector('img');
    if (!img) return;

    loadGoogleFonts();

    // ── Widget container ──────────────────────────────────────────────────────
    const widget = document.createElement('div');
    widget.id = 'engraving-preview-widget';
    widget.style.cssText = `
      margin-top: 2.5rem;
      padding: 1.5rem;
      border: 1px solid var(--color-ash);
      border-radius: 6px;
      background: #faf7f2;
    `;
    widget.innerHTML = `
      <p style="margin:0 0 1em; font-family:var(--font-mono); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-structural);">
        — Engrave Preview
      </p>
      <canvas id="engrave-canvas" style="width:100%; border-radius:4px; border:1px solid var(--color-ash); cursor:move; touch-action:none;"></canvas>
      <div style="margin-top:1rem; display:grid; gap:0.75rem;">
        <div>
          <label style="display:block; font-family:var(--font-mono); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-structural); margin-bottom:0.3em;">Your Text</label>
          <input id="engrave-text" type="text" placeholder="e.g. Ahmad & Nur Aisyah" style="width:100%; padding:0.65em 0.8em; border:1px solid var(--color-ash); border-radius:2px; font-family:var(--font-body); font-size:1rem;">
        </div>
        <div>
          <label style="display:block; font-family:var(--font-mono); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-structural); margin-bottom:0.3em;">Font Style</label>
          <div id="engrave-font-picker" style="display:flex; gap:0.5rem; flex-wrap:wrap;"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
          <div>
            <label style="display:block; font-family:var(--font-mono); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-structural); margin-bottom:0.3em;">
              Text Size <span id="engrave-size-val"></span>
            </label>
            <input id="engrave-size" type="range" min="12" max="80" value="32" style="width:100%;">
          </div>
          <div>
            <label style="display:block; font-family:var(--font-mono); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-structural); margin-bottom:0.3em;">Pattern</label>
            <select id="engrave-pattern" style="width:100%; padding:0.5em; border:1px solid var(--color-ash); border-radius:2px; font-family:var(--font-body);">
              <option value="none">None</option>
              <option value="border">Simple Border</option>
              <option value="corner">Corner Marks</option>
              <option value="lines">Double Lines</option>
              <option value="floral">Floral Ends</option>
            </select>
          </div>
        </div>
        <p style="font-family:var(--font-mono); font-size:0.7rem; color:var(--color-structural); margin:0;">
          ✦ Drag the text on the preview to reposition it
        </p>
      </div>
    `;

    section.appendChild(widget);

    // ── State ─────────────────────────────────────────────────────────────────
    const canvas = document.getElementById('engrave-canvas');
    const ctx = canvas.getContext('2d');
    let productImg = null;
    let textX = 0.5; // fractional position (0–1)
    let textY = 0.5;
    let isDragging = false;
    let dragOffX = 0;
    let dragOffY = 0;
    let currentFont = FONTS[0];
    let currentSize = 32;
    let currentText = '';
    let currentPattern = 'none';

    // ── Font picker ───────────────────────────────────────────────────────────
    const picker = document.getElementById('engrave-font-picker');
    FONTS.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.textContent = f.label;
      btn.dataset.key = f.key;
      btn.style.cssText = `
        padding: 0.35em 0.75em;
        border: 1px solid var(--color-ash);
        border-radius: 3px;
        background: ${i === 0 ? 'var(--color-char)' : 'transparent'};
        color: ${i === 0 ? 'var(--color-bone)' : 'var(--color-char)'};
        font-size: 0.8rem;
        cursor: pointer;
        font-family: ${f.css};
        transition: background 0.15s ease;
      `;
      btn.addEventListener('click', () => {
        document.querySelectorAll('#engrave-font-picker button').forEach(b => {
          b.style.background = 'transparent';
          b.style.color = 'var(--color-char)';
        });
        btn.style.background = 'var(--color-char)';
        btn.style.color = 'var(--color-bone)';
        currentFont = f;
        redraw();
      });
      picker.appendChild(btn);
    });

    // ── Input handlers ────────────────────────────────────────────────────────
    document.getElementById('engrave-text').addEventListener('input', e => {
      currentText = e.target.value;
      redraw();
    });
    document.getElementById('engrave-size').addEventListener('input', e => {
      currentSize = parseInt(e.target.value);
      document.getElementById('engrave-size-val').textContent = currentSize + 'px';
      redraw();
    });
    document.getElementById('engrave-pattern').addEventListener('change', e => {
      currentPattern = e.target.value;
      redraw();
    });
    document.getElementById('engrave-size-val').textContent = currentSize + 'px';

    // ── Canvas setup ─────────────────────────────────────────────────────────
    function initCanvas(image) {
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      productImg = image;
      redraw();
    }

    if (img.complete && img.naturalWidth) {
      initCanvas(img);
    } else {
      img.addEventListener('load', () => initCanvas(img));
    }

    // ── Draw ──────────────────────────────────────────────────────────────────
    function drawPattern(w, h, pattern) {
      ctx.strokeStyle = 'rgba(60,40,20,0.55)';
      ctx.lineWidth = Math.max(1, w / 300);

      if (pattern === 'border') {
        const m = w * 0.03;
        ctx.strokeRect(m, m, w - m * 2, h - m * 2);
      }
      if (pattern === 'corner') {
        const m = w * 0.03;
        const s = w * 0.07;
        [[m, m], [w - m, m], [m, h - m], [w - m, h - m]].forEach(([cx, cy]) => {
          const dx = cx < w / 2 ? 1 : -1;
          const dy = cy < h / 2 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(cx, cy + dy * s);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + dx * s, cy);
          ctx.stroke();
        });
      }
      if (pattern === 'lines') {
        const m = w * 0.04;
        ctx.strokeRect(m, m, w - m * 2, h - m * 2);
        const m2 = m + w * 0.015;
        ctx.strokeRect(m2, m2, w - m2 * 2, h - m2 * 2);
      }
      if (pattern === 'floral') {
        const drawFloral = (x, y) => {
          const r = w * 0.025;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, r * 0.45, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
          ctx.stroke();
        };
        const m = w * 0.05;
        drawFloral(m, m);
        drawFloral(w - m, m);
        drawFloral(m, h - m);
        drawFloral(w - m, h - m);
        drawFloral(w / 2, m);
        drawFloral(w / 2, h - m);
      }
    }

    function drawText(w, h) {
      if (!currentText) return;

      const isArabic = currentFont.key === 'arabic';
      const fontSize = Math.round(currentSize * (w / 500));
      ctx.font = `${fontSize}px ${currentFont.css}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = isArabic ? 'rtl' : 'ltr';

      const x = textX * w;
      const y = textY * h;

      // Laser-engraved look: dark brown, slightly transparent
      ctx.fillStyle = 'rgba(40, 25, 10, 0.75)';

      // Multi-line support
      const lines = currentText.split('\n');
      const lineH = fontSize * 1.3;
      lines.forEach((line, i) => {
        const ly = y + (i - (lines.length - 1) / 2) * lineH;
        ctx.fillText(line, x, ly);
      });
    }

    function redraw() {
      if (!productImg) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(productImg, 0, 0, w, h);
      if (currentPattern !== 'none') drawPattern(w, h, currentPattern);
      drawText(w, h);
    }

    // ── Drag to reposition ────────────────────────────────────────────────────
    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    canvas.addEventListener('mousedown', e => {
      isDragging = true;
      const pos = getPos(e);
      dragOffX = pos.x / canvas.width - textX;
      dragOffY = pos.y / canvas.height - textY;
    });
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      isDragging = true;
      const pos = getPos(e);
      dragOffX = pos.x / canvas.width - textX;
      dragOffY = pos.y / canvas.height - textY;
    }, { passive: false });
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const pos = getPos(e);
      textX = Math.min(1, Math.max(0, pos.x / canvas.width - dragOffX));
      textY = Math.min(1, Math.max(0, pos.y / canvas.height - dragOffY));
      redraw();
    });
    window.addEventListener('touchmove', e => {
      if (!isDragging) return;
      e.preventDefault();
      const pos = getPos(e);
      textX = Math.min(1, Math.max(0, pos.x / canvas.width - dragOffX));
      textY = Math.min(1, Math.max(0, pos.y / canvas.height - dragOffY));
      redraw();
    }, { passive: false });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('touchend', () => { isDragging = false; });

    // ── Patch Add to Cart to include engraving note ───────────────────────────
    const addBtn = document.querySelector('[data-add-to-cart]');
    if (addBtn) {
      addBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const name = addBtn.dataset.addToCart;
        const price = parseFloat(addBtn.dataset.price);
        const engravingNote = buildNote();
        Cart.addItem(name, price, engravingNote);
        const feedback = document.createElement('div');
        feedback.textContent = engravingNote
          ? `Added with engraving: "${currentText}"`
          : 'Added to cart!';
        feedback.style.cssText = `
          position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
          background:var(--color-char); color:var(--color-bone);
          padding:0.75em 1.5em; border-radius:4px;
          font-size:0.85rem; z-index:200; white-space:nowrap;
        `;
        document.body.appendChild(feedback);
        setTimeout(() => feedback.remove(), 2500);
      }, true); // capture to run before main.js handler
    }

    function buildNote() {
      if (!currentText.trim()) return '';
      const parts = [`Engraving: "${currentText.trim()}"`, `Font: ${currentFont.label}`];
      if (currentPattern !== 'none') parts.push(`Pattern: ${currentPattern}`);
      return parts.join(' | ');
    }
  }

  // ── Init on DOM ready ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Only activate on product detail pages (not catalog)
    const productSection = document.querySelector('.grid-2');
    if (!productSection) return;
    const rightCol = productSection.children[1];
    if (rightCol) buildWidget(productSection.children[0]);
  });

})();
