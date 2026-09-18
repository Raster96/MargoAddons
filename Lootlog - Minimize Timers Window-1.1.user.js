// ==UserScript==
// @name         Lootlog.pl - Minimize Timers Window
// @namespace    margonem
// @version      1.1
// @description  Dodaje przycisk minimalizacji okna timerów Lootlog dzięki czemu dodatki mogą korzystać z API od Timerów
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?domain=lootlog.pl
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  'use strict';

  let timersWindow = null;
  let minimizeButton = null;
  let isMinimized = false;

  const MINIMIZED_BUTTON_STYLE = `
    position: fixed;
    width: 35px;
    height: 35px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: 2px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
    cursor: move;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 18px;
    font-weight: bold;
    transition: all 0.3s ease;
    font-family: Arial, sans-serif;
    user-select: none;
  `;

  const MINIMIZE_WINDOW_BUTTON_STYLE = `
    box-sizing: border-box;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 0;
    background: transparent;
    color: rgb(209, 213, 219);
    cursor: pointer;
    font-family: Arial, sans-serif;
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    transition: background-color 0.15s, color 0.15s;
  `;

  function createMinimizeButtonInWindow() {
    const button = document.createElement('button');
    button.textContent = '−';
    button.type = 'button';
    button.setAttribute('data-ll-draggable', 'false');
    button.setAttribute('aria-label', 'Minimalizuj okno timerów');
    button.title = 'Minimalizuj okno timerów';
    button.style.cssText = MINIMIZE_WINDOW_BUTTON_STYLE;

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255, 255, 255, 0.1)';
      button.style.color = 'white';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = 'transparent';
      button.style.color = 'rgb(209, 213, 219)';
    });

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeTimersWindow();
    });

    return button;
  }

  function createFloatingButton() {
    const button = document.createElement('div');
    button.innerHTML = '⏱️';
    button.title = 'Pokaż okno timerów (możesz przeciągnąć)';
    button.style.cssText = MINIMIZED_BUTTON_STYLE;

    const savedPosition = GM_getValue('lootlog_button_position', { bottom: 20, right: 20 });
    button.style.bottom = savedPosition.bottom + 'px';
    button.style.right = savedPosition.right + 'px';

    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialX, initialY;

    button.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      
      // Pobierz aktualne współrzędne
      const rect = button.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      
      button.style.cursor = 'grabbing';
      button.style.transition = 'none';
      e.preventDefault();
    });

    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      hasMoved = true;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      let newX = initialX + deltaX;
      let newY = initialY + deltaY;
      
      newX = Math.max(0, Math.min(window.innerWidth - 35, newX));
      newY = Math.max(0, Math.min(window.innerHeight - 35, newY));
      
      button.style.left = newX + 'px';
      button.style.top = newY + 'px';
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    };

    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        button.style.cursor = 'move';
        button.style.transition = 'all 0.3s ease'; // Przywróć transition
        
        const rect = button.getBoundingClientRect();
        const bottom = window.innerHeight - rect.bottom;
        const right = window.innerWidth - rect.right;
        
        GM_setValue('lootlog_button_position', { bottom, right });
        
        button.style.bottom = bottom + 'px';
        button.style.right = right + 'px';
        button.style.left = 'auto';
        button.style.top = 'auto';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    button.addEventListener('click', (e) => {
      if (!hasMoved) {
        restoreTimersWindow();
      }
    });

    button.addEventListener('mouseenter', () => {
      if (!isDragging) {
        button.style.transform = 'scale(1.1)';
        button.style.boxShadow = '0 6px 15px rgba(102, 126, 234, 0.5)';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (!isDragging) {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.3)';
      }
    });

    return button;
  }

  function minimizeTimersWindow() {
    if (!timersWindow || isMinimized) return;

    timersWindow.style.display = 'none';
    isMinimized = true;
    GM_setValue('lootlog_timers_minimized', true);

    if (!minimizeButton) {
      minimizeButton = createFloatingButton();
      document.body.appendChild(minimizeButton);
    } else {
      minimizeButton.style.display = 'flex';
    }
  }

  function restoreTimersWindow() {
    if (!timersWindow || !isMinimized) return;

    timersWindow.style.display = '';
    isMinimized = false;
    GM_setValue('lootlog_timers_minimized', false);

    if (minimizeButton) {
      minimizeButton.style.display = 'none';
    }
  }

  function restoreMinimizedState() {
    const wasMinimized = GM_getValue('lootlog_timers_minimized', false);

    if (wasMinimized && timersWindow) {
      setTimeout(() => {
        minimizeTimersWindow();
      }, 500);
    }
  }

  function findAndEnhanceTimersWindow() {
    timersWindow = document.querySelector('[data-ll-draggable-window="timers"]') ||
                   document.querySelector('#ll-timers');

    if (!timersWindow) return false;

    if (timersWindow.querySelector('[data-minimize-button]')) {
      return true;
    }

    const buttonContainer = timersWindow.querySelector('[data-ll-draggable="false"].ll\\:justify-self-end') ||
                           timersWindow.querySelector('div[class*="justify-self-end"]');

    if (buttonContainer) {
      const button = createMinimizeButtonInWindow();
      button.setAttribute('data-minimize-button', 'true');
      
      buttonContainer.insertBefore(button, buttonContainer.firstChild);
      
      console.log('[Lootlog Minimize] Przycisk dodany jako pierwszy w kontenerze przycisków');
      return true;
    }

    console.log('[Lootlog Minimize] Nie znaleziono kontenera przycisków');
    return false;
  }

  function setupObserver() {
    const observer = new MutationObserver(() => {
      if (!timersWindow || !document.body.contains(timersWindow)) {
        findAndEnhanceTimersWindow();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    const checkInterval = setInterval(() => {
      if (findAndEnhanceTimersWindow()) {
        clearInterval(checkInterval);
        setupObserver();
        restoreMinimizedState();
        console.log('[Lootlog Minimize] Przycisk minimalizacji dodany do okna timerów');
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(checkInterval);
      setupObserver();
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();