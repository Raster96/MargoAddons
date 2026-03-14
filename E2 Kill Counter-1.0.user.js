// ==UserScript==
// @name         E2 Kill Counter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Liczy ubicia E2 i unikaty/heroiki/legendy oraz ulepe za nie. Wyświetla statystyki dzienne, wczorajsze, miesięczne, z poprzedniego miesiąca i łączne.
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

    let currentFighters = {};

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

    // ==================== DATE HELPERS ====================
    const getToday = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const getCurrentMonth = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    // ==================== STATS ====================
    const defaultItems = () => ({ unique: 0, heroic: 0, legendary: 0, enhUni: 0, enhHero: 0 });

    const getDefaultStats = () => ({
        today: { value: 0, date: getToday(), items: defaultItems() },
        yesterday: { value: 0, date: '', items: defaultItems() },
        dailyRecord: { value: 0, date: '' },
        month: { value: 0, month: getCurrentMonth(), items: defaultItems() },
        prevMonth: { value: 0, month: '', items: defaultItems() },
        total: 0,
        totalItems: defaultItems()
    });

    const ensureItems = (obj) => {
        if (!obj.items) obj.items = defaultItems();
        if (obj.items.enhUni === undefined) obj.items.enhUni = 0;
        if (obj.items.enhHero === undefined) obj.items.enhHero = 0;
        return obj;
    };

    const loadStats = () => {
        let stats = GM_getValue('e2Stats', null);
        if (!stats) {
            stats = getDefaultStats();
            GM_setValue('e2Stats', stats);
            return stats;
        }

        ensureItems(stats.today);
        ensureItems(stats.yesterday);
        ensureItems(stats.month);
        ensureItems(stats.prevMonth);
        if (!stats.totalItems) stats.totalItems = defaultItems();
        if (stats.totalItems.enhUni === undefined) stats.totalItems.enhUni = 0;
        if (stats.totalItems.enhHero === undefined) stats.totalItems.enhHero = 0;
        if (!stats.dailyRecord) stats.dailyRecord = { value: 0, date: '' };

        const today = getToday();
        const currentMonth = getCurrentMonth();
        let changed = false;

        if (stats.today.date !== today) {
            stats.yesterday = { value: stats.today.value, date: stats.today.date, items: { ...stats.today.items } };
            stats.today = { value: 0, date: today, items: defaultItems() };

            changed = true;
        }

        if (stats.month.month !== currentMonth) {
            stats.prevMonth = { value: stats.month.value, month: stats.month.month, items: { ...stats.month.items } };
            stats.month = { value: 0, month: currentMonth, items: defaultItems() };
            changed = true;
        }

        if (changed) {
            GM_setValue('e2Stats', stats);
        }

        return stats;
    };

    const countItemRarities = (data) => {
        const counts = defaultItems();
        if (typeof data.item !== 'object') return counts;

        for (const [, item] of Object.entries(data.item)) {
            if (!item.stat) continue;

            const match = item.stat.match(/rarity=([^;]+)/);
            const rarity = match ? match[1] : '';
            const enh = item.enhancementPoints ? parseInt(item.enhancementPoints) || 0 : 0;

            if (rarity === 'unique') { counts.unique++; counts.enhUni += enh; }
            else if (rarity === 'heroic') { counts.heroic++; counts.enhHero += enh; }
            else if (rarity === 'legendary') counts.legendary++;
        }

        return counts;
    };

    const incrementKill = (count = 1, itemCounts = null) => {
        let stats = loadStats();
        stats.today.value += count;
        stats.month.value += count;
        stats.total += count;

        if (itemCounts) {
            for (const r of ['unique', 'heroic', 'legendary', 'enhUni', 'enhHero']) {
                stats.today.items[r] += itemCounts[r];
                stats.month.items[r] += itemCounts[r];
                stats.totalItems[r] += itemCounts[r];
            }
        }

        if (stats.today.value > stats.dailyRecord.value) {
            stats.dailyRecord.value = stats.today.value;
            stats.dailyRecord.date = stats.today.date;
        }

        GM_setValue('e2Stats', stats);
        return stats;
    };

    // ==================== FIGHT DETECTION ====================
    const isE2 = (fighter) => {
        return fighter.npc === 1 && fighter.wt > 19 && fighter.wt < 29;
    };

    const getItemIds = (data) => {
        if (typeof data.item !== 'object') return '';
        return Object.keys(data.item).sort().join(',');
    };

    const waitForGame = setInterval(() => {
        if (typeof Engine !== 'undefined' && Engine.communication) {
            clearInterval(waitForGame);
            initAddon();
        }
    }, 100);

    function initAddon() {
        isVisible = GM_getValue('e2Visible', true);
        createStyles();
        createToggleButton();
        createCounterMenu();
        setupIntercept();
    }

    function setupIntercept() {
        intercept(Engine.communication, 'parseJSON', (data) => {
            if (typeof data.f !== 'object') return;

            if (data.f.init) {
                currentFighters = {};
                const fighters = data.f.w;
                if (fighters) {
                    for (const [id, fighter] of Object.entries(fighters)) {
                        if (isE2(fighter)) {
                            currentFighters[id] = {
                                name: fighter.name,
                                wt: fighter.wt,
                            };
                        }
                    }
                }
            }

            if (data.f.endBattle) {
                const e2Count = Object.keys(currentFighters).length;

                if (e2Count > 0 && Array.isArray(data.f.m)) {
                    const itemIds = getItemIds(data);
                    const lastItemIds = GM_getValue('e2LastItemIds', '');

                    if (itemIds !== lastItemIds) {
                        const heroName = Engine.hero.d.nick;
                        const won = data.f.m.some(msg =>
                            typeof msg === 'string' && msg.includes('winner=' + heroName)
                        );

                        if (won) {
                            if (itemIds) GM_setValue('e2LastItemIds', itemIds);
                            const itemCounts = countItemRarities(data);
                            incrementKill(e2Count, itemCounts);
                            updateCounterMenu();
                        }
                    }
                }

                currentFighters = {};
            }
        });
    }

    // ==================== UI ====================
    function toggleWindow() {
        isVisible = !isVisible;
        counterMenu.style.display = isVisible ? 'block' : 'none';
        GM_setValue('e2Visible', isVisible);
    }

    function closeWindow() {
        isVisible = false;
        counterMenu.style.display = 'none';
        GM_setValue('e2Visible', isVisible);
    }

    function loadMenuPosition() {
        return GM_getValue('e2MenuPosition', { x: 10, y: 100 });
    }

    function loadMenuSize() {
        return GM_getValue('e2MenuSize', { width: 280, height: 300 });
    }

    function saveMenuPosition(x, y) {
        GM_setValue('e2MenuPosition', { x, y });
    }

    function saveMenuSize(width, height) {
        GM_setValue('e2MenuSize', { width, height });
    }

    function loadTogglePosition() {
        return GM_getValue('e2TogglePosition', { x: 60, y: 10 });
    }

    function saveTogglePosition(x, y) {
        GM_setValue('e2TogglePosition', { x, y });
    }

    // ==================== STYLES ====================
    function createStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .e2-counter-advanced {
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

            .e2-resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 20px;
                height: 20px;
                cursor: nw-resize;
                background: linear-gradient(135deg, transparent 0%, transparent 40%, #555 40%, #555 60%, transparent 60%);
                border-bottom-right-radius: 12px;
            }

            .e2-resize-handle:hover {
                background: linear-gradient(135deg, transparent 0%, transparent 40%, #777 40%, #777 60%, transparent 60%);
            }

            .e2-counter-title {
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

            .e2-close-btn {
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

            .e2-close-btn:hover {
                background: #c0392b;
            }

            .e2-counter-title::before {
                content: '⚔️';
                margin-right: 8px;
                font-size: 16px;
            }

            .e2-toggle-button {
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

            .e2-counter-body {
                display: flex;
                flex-direction: column;
                height: calc(100% - 46px);
                position: relative;
            }

            .e2-counter-content {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                background: #0d0d0d;
                min-height: 100px;
                scroll-behavior: smooth;
                padding: 8px 0;
            }

            .e2-stat-item {
                padding: 10px 16px;
                border-bottom: 1px solid #222;
                color: #fff;
                font-size: 13px;
                transition: all 0.3s ease;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .e2-stat-item:hover {
                background: linear-gradient(90deg, rgba(255, 100, 100, 0.1) 0%, rgba(255, 100, 100, 0.05) 100%);
            }

            .e2-stat-item:last-child {
                border-bottom: none;
            }

            .e2-stat-label {
                font-weight: 500;
                color: #ccc;
                font-size: 13px;
            }

            .e2-stat-value {
                font-weight: bold;
                color: #ff6b6b;
                font-size: 15px;
                min-width: 40px;
                text-align: right;
            }

            .e2-stat-value.today {
                color: #4eff00;
            }

            .e2-stat-value.yesterday {
                color: #87ceeb;
            }

            .e2-stat-value.month {
                color: #ffd700;
            }

            .e2-stat-value.prev-month {
                color: #ffa500;
            }

            .e2-stat-value.total {
                color: #ff6b6b;
                font-size: 17px;
            }

            .e2-stat-separator {
                height: 1px;
                background: linear-gradient(90deg, transparent, #444, transparent);
                margin: 4px 16px;
            }

            .e2-counter-content::-webkit-scrollbar {
                width: 8px;
            }

            .e2-counter-content::-webkit-scrollbar-track {
                background: #0d0d0d;
            }

            .e2-counter-content::-webkit-scrollbar-thumb {
                background: linear-gradient(135deg, #444 0%, #333 100%);
                border-radius: 4px;
            }

            .e2-counter-content::-webkit-scrollbar-thumb:hover {
                background: linear-gradient(135deg, #555 0%, #444 100%);
            }
        `;
        document.head.appendChild(style);
    }

    // ==================== TOGGLE BUTTON ====================
    function createToggleButton() {
        toggleButton = document.createElement('div');
        toggleButton.className = 'e2-toggle-button';
        toggleButton.textContent = '⚔️';
        addTip(toggleButton, 'E2 Kill Counter');

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
        counterMenu.className = 'e2-counter-advanced';

        const position = loadMenuPosition();
        const size = loadMenuSize();
        counterMenu.style.left = position.x + 'px';
        counterMenu.style.top = position.y + 'px';
        counterMenu.style.width = size.width + 'px';
        counterMenu.style.height = size.height + 'px';

        const title = document.createElement('div');
        title.className = 'e2-counter-title';
        title.textContent = 'E2 Kill Counter';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'e2-close-btn';
        closeBtn.textContent = '✕';
        addTip(closeBtn, 'Zamknij');
        closeBtn.addEventListener('click', closeWindow);

        title.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'e2-counter-body';

        const content = document.createElement('div');
        content.className = 'e2-counter-content';

        resizeHandle = document.createElement('div');
        resizeHandle.className = 'e2-resize-handle';
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

        const content = counterMenu.querySelector('.e2-counter-content');
        if (!content) return;
        content.innerHTML = '';

        const stats = loadStats();

        const fmtNum = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        const formatItemTip = (items) => {
            if (!items) return '';
            const parts = [];
            if (items.unique) parts.push(`Unikaty: ${items.unique}`);
            if (items.heroic) parts.push(`Heroiki: ${items.heroic}`);
            if (items.legendary) parts.push(`Legendy: ${items.legendary}`);
            if (items.enhUni) parts.push(`<br>Ulepa uni:<br>${fmtNum(items.enhUni)}`);
            if (items.enhHero) parts.push(`Ulepa hero:<br>${fmtNum(items.enhHero)}`);
            return parts.length ? parts.join('<br>') : 'Brak lootów';
        };

        const rows = [
            { label: 'Dzisiaj', value: stats.today.value, cls: 'today', tip: formatItemTip(stats.today.items) },
            { label: 'Wczoraj', value: stats.yesterday.value, cls: 'yesterday', tip: formatItemTip(stats.yesterday.items) },
            { label: 'Rekord dzienny', value: stats.dailyRecord.value, cls: 'today', tip: stats.dailyRecord.date ? `Data: ${stats.dailyRecord.date}` : 'Brak rekordu' },
            { separator: true },
            { label: 'Miesiąc', value: stats.month.value, cls: 'month', tip: formatItemTip(stats.month.items) },
            { label: 'Poprzedni miesiąc', value: stats.prevMonth.value, cls: 'prev-month', tip: formatItemTip(stats.prevMonth.items) },
            { separator: true },
            { label: 'Wszystkie bicia', value: stats.total, cls: 'total', tip: formatItemTip(stats.totalItems) },
        ];

        rows.forEach(row => {
            if (row.separator) {
                const sep = document.createElement('div');
                sep.className = 'e2-stat-separator';
                content.appendChild(sep);
                return;
            }

            const item = document.createElement('div');
            item.className = 'e2-stat-item';

            const labelDiv = document.createElement('div');
            labelDiv.className = 'e2-stat-label';
            labelDiv.textContent = row.label;

            const valueDiv = document.createElement('div');
            valueDiv.className = `e2-stat-value ${row.cls}`;
            valueDiv.textContent = row.value;

            if (row.tip) {
                addTip(item, row.tip);
            }

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
