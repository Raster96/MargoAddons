// ==UserScript==
// @name         Chest Counter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Liczy skrzynie z herosów i wyświetla w tipie statystyki dla rzadkości zdobytych przedmiotów. Lista sortowana według lvl.
// @author       You
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    let counterMenu = null;
    let toggleButton = null;
    let resizeHandle = null;
    let isVisible = true;
    let isDragging = false;
    let isDraggingToggle = false;
    let isResizing = false;
    let dragOffset = { x: 0, y: 0 };
    let toggleDragOffset = { x: 0, y: 0 };
    let resizeStartSize = { width: 0, height: 0 };
    let resizeStartMouse = { x: 0, y: 0 };

    const addTip = (element, text) => {
        $(element).tip(text);
    };

    // ==================== INTERCEPT ====================
    const intercept = (obj, key, cb, original = obj[key]) => {
        obj[key] = (...args) => {
            const result = original.apply(obj, args);
            cb(...args);
            return result;
        };
    };

    // ==================== CHEST STATS ====================
    const defaultChestRarity = () => ({ common: 0, unique: 0, heroic: 0, legendary: 0 });

    const loadChestStats = () => {
        return GM_getValue('chestStats', {});
    };

    const extractHeroName = (opis) => {
        if (!opis) return null;
        const prefix = 'Jeden z 18 składników legendarnego stroju';
        if (!opis.includes(prefix)) return null;
        const afterPrefix = opis.split('[br]')[1];
        if (!afterPrefix) return null;
        const dotIdx = afterPrefix.indexOf('.');
        if (dotIdx === -1) return null;
        return afterPrefix.substring(0, dotIdx).trim();
    };

    const incrementChest = (heroName, rarity, lvl) => {
        let chests = loadChestStats();
        if (!chests[heroName]) {
            chests[heroName] = defaultChestRarity();
            chests[heroName].lvl = lvl || 0;
        }
        const r = rarity || 'common';
        if (chests[heroName][r] !== undefined) {
            chests[heroName][r]++;
        }
        GM_setValue('chestStats', chests);
        return chests;
    };

    // ==================== GAME INIT ====================
    const waitForGame = setInterval(() => {
        if (typeof Engine !== 'undefined' && Engine.communication) {
            clearInterval(waitForGame);
            initAddon();
        }
    }, 100);

    function initAddon() {
        isVisible = GM_getValue('chestVisible', true);
        createStyles();
        createToggleButton();
        createCounterMenu();
        setupIntercept();
    }

    function setupIntercept() {
        intercept(Engine.communication, 'parseJSON', (data) => {
            if (data.loot && data.loot.source === 'lootbox' && typeof data.item === 'object' && typeof data.loot.states === 'object') {
                for (const itemId of Object.keys(data.loot.states)) {
                    const item = data.item[itemId];
                    if (!item || !item.stat) continue;

                    const lastChestItemId = GM_getValue('chestLastItemId', '');
                    if (itemId === lastChestItemId) continue;

                    const opisMatch = item.stat.match(/opis=([^;]*(?:\[br\][^;]*)*)/);
                    const opis = opisMatch ? opisMatch[1] : '';
                    const heroName = extractHeroName(opis);
                    if (!heroName) continue;

                    const rarityMatch = item.stat.match(/rarity=([^;]+)/);
                    const rarity = rarityMatch ? rarityMatch[1] : 'common';

                    const lvlMatch = item.stat.match(/lvl=(\d+)/);
                    const lvl = lvlMatch ? parseInt(lvlMatch[1]) : 0;

                    GM_setValue('chestLastItemId', itemId);
                    incrementChest(heroName, rarity, lvl);
                    updateCounterMenu();
                }
            }
        });
    }

    // ==================== UI ====================
    function toggleWindow() {
        isVisible = !isVisible;
        counterMenu.style.display = isVisible ? 'block' : 'none';
        GM_setValue('chestVisible', isVisible);
    }

    function closeWindow() {
        isVisible = false;
        counterMenu.style.display = 'none';
        GM_setValue('chestVisible', isVisible);
    }

    function loadMenuPosition() {
        return GM_getValue('chestMenuPosition', { x: 10, y: 100 });
    }

    function loadMenuSize() {
        return GM_getValue('chestMenuSize', { width: 280, height: 300 });
    }

    function saveMenuPosition(x, y) {
        GM_setValue('chestMenuPosition', { x, y });
    }

    function saveMenuSize(width, height) {
        GM_setValue('chestMenuSize', { width, height });
    }

    function loadTogglePosition() {
        return GM_getValue('chestTogglePosition', { x: 110, y: 10 });
    }

    function saveTogglePosition(x, y) {
        GM_setValue('chestTogglePosition', { x, y });
    }

    // ==================== STYLES ====================
    function createStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .chest-counter-advanced {
                position: fixed;
                background: linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%);
                border: 1px solid #333;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8),
                           0 0 0 1px rgba(255, 255, 255, 0.1) inset;
                z-index: 15;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-width: 240px;
                min-height: 200px;
                backdrop-filter: blur(10px);
                overflow: hidden;
                resize: none;
            }

            .chest-resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 20px;
                height: 20px;
                cursor: nw-resize;
                background: linear-gradient(135deg, transparent 0%, transparent 40%, #555 40%, #555 60%, transparent 60%);
                border-bottom-right-radius: 12px;
            }

            .chest-resize-handle:hover {
                background: linear-gradient(135deg, transparent 0%, transparent 40%, #777 40%, #777 60%, transparent 60%);
            }

            .chest-counter-title {
                background: linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%);
                color: #fff;
                padding: 12px 16px;
                font-weight: 600;
                font-size: 14px;
                cursor: move;
                user-select: none;
                border-bottom: 1px solid #333;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
            }

            .chest-close-btn {
                position: absolute;
                right: 12px;
                background: #e74c3c;
                color: white;
                border: none;
                width: 24px;
                height: 24px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }

            .chest-close-btn:hover {
                background: #c0392b;
            }

            .chest-counter-title::before {
                content: '📦';
                margin-right: 8px;
                font-size: 16px;
            }

            .chest-toggle-button {
                position: fixed;
                width: 44px;
                height: 44px;
                background: linear-gradient(145deg, #2d2d2d 0%, #1a1a1a 100%);
                border: 1px solid #333;
                border-radius: 8px;
                color: white;
                font-size: 20px;
                cursor: move;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 16;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
                transition: all 0.2s ease;
                user-select: none;
            }

            .chest-counter-body {
                display: flex;
                flex-direction: column;
                height: calc(100% - 46px);
                position: relative;
            }

            .chest-counter-content {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                background: #0d0d0d;
                min-height: 100px;
                scroll-behavior: smooth;
                padding: 8px 0;
            }

            .chest-stat-item {
                padding: 10px 16px;
                border-bottom: 1px solid #222;
                color: #fff;
                font-size: 13px;
                transition: all 0.3s ease;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .chest-stat-item:hover {
                background: linear-gradient(90deg, rgba(255, 200, 100, 0.1) 0%, rgba(255, 200, 100, 0.05) 100%);
            }

            .chest-stat-item:last-child {
                border-bottom: none;
            }

            .chest-stat-label {
                font-weight: 500;
                color: #b8a88a;
                font-size: 12px;
            }

            .chest-stat-value {
                font-weight: bold;
                color: #ffd700;
                font-size: 15px;
                min-width: 40px;
                text-align: right;
            }

            .chest-stat-separator {
                height: 1px;
                background: linear-gradient(90deg, transparent, #444, transparent);
                margin: 4px 16px;
            }

            .chest-empty {
                color: #666;
                text-align: center;
                padding: 20px 16px;
                font-size: 13px;
                font-style: italic;
            }

            .chest-counter-content::-webkit-scrollbar {
                width: 8px;
            }

            .chest-counter-content::-webkit-scrollbar-track {
                background: #0d0d0d;
            }

            .chest-counter-content::-webkit-scrollbar-thumb {
                background: linear-gradient(135deg, #444 0%, #333 100%);
                border-radius: 4px;
            }

            .chest-counter-content::-webkit-scrollbar-thumb:hover {
                background: linear-gradient(135deg, #555 0%, #444 100%);
            }
        `;
        document.head.appendChild(style);
    }

    // ==================== TOGGLE BUTTON ====================
    function createToggleButton() {
        toggleButton = document.createElement('div');
        toggleButton.className = 'chest-toggle-button';
        toggleButton.textContent = '📦';
        addTip(toggleButton, 'Chest Counter');

        const position = loadTogglePosition();
        toggleButton.style.left = position.x + 'px';
        toggleButton.style.top = position.y + 'px';

        toggleButton.addEventListener('click', toggleWindow);
        toggleButton.addEventListener('mousedown', startToggleDrag);

        document.body.appendChild(toggleButton);
    }

    // ==================== COUNTER MENU ====================
    function createCounterMenu() {
        counterMenu = document.createElement('div');
        counterMenu.className = 'chest-counter-advanced';

        const position = loadMenuPosition();
        const size = loadMenuSize();
        counterMenu.style.left = position.x + 'px';
        counterMenu.style.top = position.y + 'px';
        counterMenu.style.width = size.width + 'px';
        counterMenu.style.height = size.height + 'px';

        const title = document.createElement('div');
        title.className = 'chest-counter-title';
        title.textContent = 'Chest Counter';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'chest-close-btn';
        closeBtn.textContent = '✕';
        addTip(closeBtn, 'Zamknij');
        closeBtn.addEventListener('click', closeWindow);

        title.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'chest-counter-body';

        const content = document.createElement('div');
        content.className = 'chest-counter-content';

        resizeHandle = document.createElement('div');
        resizeHandle.className = 'chest-resize-handle';
        addTip(resizeHandle, 'Przeciągnij aby zmienić rozmiar');

        body.appendChild(content);

        counterMenu.appendChild(title);
        counterMenu.appendChild(body);
        counterMenu.appendChild(resizeHandle);

        title.addEventListener('mousedown', startDrag);
        resizeHandle.addEventListener('mousedown', startResize);
        content.addEventListener('wheel', handleWheelScroll, { passive: false });

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        document.body.appendChild(counterMenu);

        counterMenu.style.display = isVisible ? 'block' : 'none';

        updateCounterMenu();
    }

    function updateCounterMenu() {
        if (!counterMenu) return;

        const content = counterMenu.querySelector('.chest-counter-content');
        if (!content) return;
        content.innerHTML = '';

        const chests = loadChestStats();
        const chestNames = Object.keys(chests)
            .sort((a, b) => (chests[a].lvl || 0) - (chests[b].lvl || 0));

        if (chestNames.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'chest-empty';
            empty.textContent = 'Brak otwartych skrzyń';
            content.appendChild(empty);
            return;
        }

        chestNames.forEach(heroName => {
            const c = chests[heroName];
            const total = (c.common || 0) + (c.unique || 0) + (c.heroic || 0) + (c.legendary || 0);

            const tipParts = [];
            tipParts.push(`Zwykłe: ${c.common || 0}`);
            tipParts.push(`Unikaty: ${c.unique || 0}`);
            tipParts.push(`Heroiki: ${c.heroic || 0}`);
            tipParts.push(`Legendy: ${c.legendary || 0}`);

            const item = document.createElement('div');
            item.className = 'chest-stat-item';

            const labelDiv = document.createElement('div');
            labelDiv.className = 'chest-stat-label';
            labelDiv.textContent = `Skrzynia ${heroName}`;

            const valueDiv = document.createElement('div');
            valueDiv.className = 'chest-stat-value';
            valueDiv.textContent = total;

            addTip(item, tipParts.join('<br>'));

            item.appendChild(labelDiv);
            item.appendChild(valueDiv);
            content.appendChild(item);
        });
    }

    // ==================== DRAG & RESIZE ====================
    function startDrag(e) {
        isDragging = true;
        const rect = counterMenu.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        e.preventDefault();
    }

    function startResize(e) {
        isResizing = true;
        const rect = counterMenu.getBoundingClientRect();
        resizeStartSize.width = rect.width;
        resizeStartSize.height = rect.height;
        resizeStartMouse.x = e.clientX;
        resizeStartMouse.y = e.clientY;
        e.preventDefault();
        e.stopPropagation();
    }

    function handleMouseMove(e) {
        if (isDragging) {
            const x = e.clientX - dragOffset.x;
            const y = e.clientY - dragOffset.y;

            counterMenu.style.left = Math.max(0, Math.min(window.innerWidth - counterMenu.offsetWidth, x)) + 'px';
            counterMenu.style.top = Math.max(0, Math.min(window.innerHeight - counterMenu.offsetHeight, y)) + 'px';
        }

        if (isResizing) {
            const deltaX = e.clientX - resizeStartMouse.x;
            const deltaY = e.clientY - resizeStartMouse.y;

            const newWidth = Math.max(240, resizeStartSize.width + deltaX);
            const newHeight = Math.max(200, resizeStartSize.height + deltaY);

            counterMenu.style.width = newWidth + 'px';
            counterMenu.style.height = newHeight + 'px';
        }

        if (isDraggingToggle) {
            const x = e.clientX - toggleDragOffset.x;
            const y = e.clientY - toggleDragOffset.y;

            toggleButton.style.left = Math.max(0, Math.min(window.innerWidth - toggleButton.offsetWidth, x)) + 'px';
            toggleButton.style.top = Math.max(0, Math.min(window.innerHeight - toggleButton.offsetHeight, y)) + 'px';
        }
    }

    function handleMouseUp() {
        if (isDragging) {
            isDragging = false;
            const rect = counterMenu.getBoundingClientRect();
            saveMenuPosition(rect.left, rect.top);
        }

        if (isResizing) {
            isResizing = false;
            const rect = counterMenu.getBoundingClientRect();
            saveMenuSize(rect.width, rect.height);
        }

        if (isDraggingToggle) {
            isDraggingToggle = false;
            const rect = toggleButton.getBoundingClientRect();
            saveTogglePosition(rect.left, rect.top);
        }
    }

    function handleWheelScroll(e) {
        e.preventDefault();
        e.stopPropagation();

        const content = e.currentTarget;
        const scrollAmount = e.deltaY;

        const canScrollUp = content.scrollTop > 0;
        const canScrollDown = content.scrollTop < (content.scrollHeight - content.clientHeight);

        if ((scrollAmount > 0 && canScrollDown) || (scrollAmount < 0 && canScrollUp)) {
            content.scrollTop += scrollAmount;
        }
    }

    function startToggleDrag(e) {
        isDraggingToggle = true;
        const rect = toggleButton.getBoundingClientRect();
        toggleDragOffset.x = e.clientX - rect.left;
        toggleDragOffset.y = e.clientY - rect.top;
        e.preventDefault();
        e.stopPropagation();
    }
})();
