// ==UserScript==
// @name         Fusion Recipe Highlighter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  W oknie "Wyświetl przepisy" (Fuzja) podświetla składniki na zielono/czerwono w zależności czy masz je w torbie. Symbol po prawej jest zielony gdy masz wszystkie składniki. Pozwala filtrować przepisy według posiadanych składników.
// @author       You
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const waitForEngine = (cb) => {
    if (typeof Engine !== 'undefined' && Engine.communication) cb();
    else setTimeout(() => waitForEngine(cb), 300);
  };

  waitForEngine(() => {

    const style = document.createElement('style');
    style.textContent = `
      .fhl-have::after,
      .fhl-missing::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 9999;
      }
      .fhl-have::after  { box-shadow: inset 0 0 0 2px #00cc44; }
      .fhl-missing::after { box-shadow: inset 0 0 0 2px #cc2200; }
      .fhl-have, .fhl-missing { position: relative; }

      .fhl-filter-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 4px 0 2px;
      }
      .fhl-filter-wrap select {
        background: #1a1a1a;
        color: #d4b483;
        border: 1px solid #6b4f2a;
        border-radius: 3px;
        padding: 3px 8px;
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        outline: none;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,200,100,0.08);
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23d4b483'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 6px center;
        padding-right: 22px;
      }
      .fhl-filter-wrap select:hover {
        border-color: #a07840;
        color: #f0d090;
      }
      .fhl-filter-wrap select option {
        background: #1a1a1a;
        color: #d4b483;
      }
      .fhl-filter-label {
        color: #a08050;
        font-size: 11px;
        font-family: inherit;
      }
    `;
    document.head.appendChild(style);

    let currentFilter = 'show-all';

    function getBagTplSet() {
      const tplSet = new Set();
      try {
        const bagItems = Engine.items.fetchLocationItems('g');
        for (const item of bagItems) {
          if (item && item.tpl) tplSet.add(String(item.tpl));
        }
      } catch (e) {}
      return tplSet;
    }

    function getItemIdFromElement(el) {
      for (const cls of el.classList) {
        const m = cls.match(/^item-id-(\d+)$/);
        if (m) return m[1];
      }
      return null;
    }

    function applyFilter() {
      document.querySelectorAll('.socket-recipe-preview-one-item').forEach((row) => {
        const have  = parseInt(row.dataset.fhlHave  ?? '0');
        const total = parseInt(row.dataset.fhlTotal ?? '0');
        let visible = true;
        if (currentFilter === 'any')      visible = have > 0;
        else if (currentFilter === 'all') visible = have === total && total > 0;
        row.style.display = visible ? '' : 'none';
      });
      try { $('.scroll-wrapper', document).trigger('update'); } catch(e) {}
    }

    function injectFilter(wndEl) {
      const txtEl = wndEl.querySelector('.items-txt');
      if (!txtEl || txtEl.querySelector('.fhl-filter-wrap')) return;

      const wrap = document.createElement('div');
      wrap.className = 'fhl-filter-wrap';

      const label = document.createElement('span');
      label.className = 'fhl-filter-label';
      label.textContent = 'Pokaż:';

      const select = document.createElement('select');
      [
        { value: 'show-all', label: 'Wszystkie' },
        { value: 'any',      label: 'Mam składnik (≥1)' },
        { value: 'all',      label: 'Kompletne (3/3)' },
      ].forEach(({ value, label: text }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        select.appendChild(opt);
      });

      select.addEventListener('change', () => {
        currentFilter = select.value;
        applyFilter();
      });

      wrap.appendChild(label);
      wrap.appendChild(select);
      txtEl.appendChild(wrap);
    }

    function highlightRecipeWindow() {
      const bagTpls = getBagTplSet();

      let attempts = 0;
      const tryHighlight = () => {
        const rows = document.querySelectorAll('.socket-recipe-preview-one-item');
        if (!rows.length) {
          if (++attempts < 30) setTimeout(tryHighlight, 100);
          return;
        }

        const wndEl = rows[0].closest('.scroll-wrapper')?.parentElement?.parentElement;
        if (wndEl) injectFilter(wndEl);

        rows.forEach((row) => {
          const leftEls = row.querySelectorAll('.left-items > .item');
          let haveCount = 0;
          leftEls.forEach((el) => {
            const id = getItemIdFromElement(el);
            if (id === null) return;
            el.classList.remove('fhl-have', 'fhl-missing');
            const inBag = bagTpls.has(id);
            el.classList.add(inBag ? 'fhl-have' : 'fhl-missing');
            if (inBag) haveCount++;
          });

          row.dataset.fhlHave  = haveCount;
          row.dataset.fhlTotal = leftEls.length;

          const allHave = haveCount === leftEls.length && leftEls.length > 0;
          row.querySelectorAll('.right-items > .item').forEach((el) => {
            el.classList.remove('fhl-have', 'fhl-missing');
            el.classList.add(allHave ? 'fhl-have' : 'fhl-missing');
          });
        });

        applyFilter();
      };

      tryHighlight();
    }

    const origParseJSON = Engine.communication.parseJSON.bind(Engine.communication);
    Engine.communication.parseJSON = function (data) {
      if (data && data.socket && data.socket.composePreviewRecipes) {
        highlightRecipeWindow();
      }
      return origParseJSON(data);
    };
  });
})();
