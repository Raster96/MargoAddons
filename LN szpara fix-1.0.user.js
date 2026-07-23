// ==UserScript==
// @name         LN szpara fix
// @namespace    https://margonem.pl/
// @version      1.0
// @description  Naprawia przezroczystą szparę na górze i dole notyfikatora wokół okna łupów
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`
        /* Naprawienie szpary na górze i dole notyfikatora wokół okna łupów */
        body.ln-active.ln-frame-loot-active .loot-wnd:has([data-item-type=t-leg]).border-window::before,
        body.ln-active.ln-frame-loot-active .loot-wnd:has([data-item-type=t-leg]).border-window::after {
            top: -33px !important;
            height: calc(100% + 65px) !important;
        }
    `);

})();
