// ==UserScript==
// @name         Depo Outfits Preview
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Podgląd outfitów i maskotek z depozytu - animowane postacie z ikoną przedmiotu
// @author       You
// @match        http*://*.margonem.pl/
// @exclude      http*://margonem.*/*
// @exclude      http*://www.margonem.*/*
// @exclude      http*://new.margonem.*/*
// @exclude      http*://forum.margonem.*/*
// @exclude      http*://commons.margonem.*/*
// @exclude      http*://dev-commons.margonem.*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ==================== STATE ====================
    let previewWindow = null;
    let cardObserver = null;
    let collectedOutfits = [];
    let collectedPets = [];
    let activeCardCanvases = new Map(); // el -> wrapperId

    // ==================== STYLES ====================
    const injectStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            .depo-preview-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.65);
                z-index: 100;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: depo-preview-fadein 0.2s ease;
            }
            @keyframes depo-preview-fadein {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            .depo-preview-window {
                position: relative;
                width: 760px;
                max-width: 92vw;
                height: 580px;
                max-height: 85vh;
                background: linear-gradient(145deg, rgba(20, 22, 30, 0.95) 0%, rgba(10, 12, 18, 0.97) 100%);
                border: 1px solid rgba(100, 140, 220, 0.3);
                border-radius: 12px;
                box-shadow:
                    0 16px 64px rgba(0, 0, 0, 0.7),
                    0 0 1px rgba(255, 255, 255, 0.1) inset,
                    0 0 40px rgba(60, 100, 180, 0.1);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: depo-preview-scalein 0.2s ease;
            }
            @keyframes depo-preview-scalein {
                from { transform: scale(0.95); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }

            .depo-preview-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                background: linear-gradient(135deg, rgba(30, 35, 50, 0.9) 0%, rgba(20, 24, 35, 0.9) 100%);
                border-bottom: 1px solid rgba(100, 140, 220, 0.15);
            }
            .depo-preview-title {
                color: #aaccff;
                font-weight: 700;
                font-size: 14px;
                letter-spacing: 0.5px;
            }
            .depo-preview-close {
                background: rgba(180, 60, 60, 0.7);
                color: #fff;
                border: none;
                width: 26px; height: 26px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .depo-preview-close:hover {
                background: rgba(220, 70, 70, 0.9);
            }

            .depo-preview-tabs {
                display: flex;
                gap: 0;
                padding: 0 16px;
                background: rgba(15, 18, 25, 0.5);
                border-bottom: 1px solid rgba(100, 140, 220, 0.1);
            }
            .depo-preview-tab {
                padding: 10px 20px;
                color: #667;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                transition: all 0.2s;
                user-select: none;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .depo-preview-tab:hover {
                color: #99aacc;
            }
            .depo-preview-tab.active {
                color: #aaccff;
                border-bottom-color: #5588dd;
            }
            .depo-preview-tab .count {
                display: inline-block;
                margin-left: 6px;
                padding: 1px 6px;
                background: rgba(80, 120, 200, 0.2);
                border-radius: 8px;
                font-size: 10px;
                color: #7799cc;
            }
            .depo-preview-tab.active .count {
                background: rgba(80, 120, 200, 0.35);
                color: #aaccff;
            }

            .depo-preview-body {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                scrollbar-width: thin;
                scrollbar-color: rgba(80, 120, 200, 0.3) transparent;
                contain: layout;
            }
            .depo-preview-body::-webkit-scrollbar { width: 6px; }
            .depo-preview-body::-webkit-scrollbar-track { background: transparent; }
            .depo-preview-body::-webkit-scrollbar-thumb { background: rgba(80, 120, 200, 0.3); border-radius: 3px; }

            .depo-preview-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(115px, 1fr));
                gap: 12px;
            }

            .depo-preview-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 10px 6px 8px;
                background: rgba(25, 30, 45, 0.6);
                border: 1px solid rgba(80, 120, 200, 0.12);
                border-radius: 8px;
                transition: transform 0.15s, border-color 0.15s;
                position: relative;
                min-height: 120px;
            }
            .depo-preview-card:hover {
                background: rgba(35, 45, 70, 0.7);
                border-color: rgba(80, 120, 200, 0.3);
                transform: translateY(-2px);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            }

            .depo-preview-card .canvas-wrapper {
                width: 80px;
                height: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
            }
            .depo-preview-card canvas {
                image-rendering: pixelated;
            }

            .depo-preview-card .item-icon-wrapper {
                position: absolute;
                top: 6px;
                right: 6px;
                z-index: 2;
                border-radius: 4px;
                overflow: hidden;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                border: 1px solid rgba(100,140,220,0.25);
                background: rgba(15, 18, 25, 0.85);
                width: 32px;
                height: 32px;
            }
            .depo-preview-card .item-icon-wrapper .item {
                position: relative !important;
                left: auto !important;
                top: auto !important;
                margin: 0 !important;
            }

            .depo-preview-card .card-name {
                margin-top: 6px;
                color: #8899bb;
                font-size: 11px;
                text-align: center;
                max-width: 100%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                line-height: 1.3;
            }

            .depo-preview-empty {
                text-align: center;
                padding: 60px 20px;
                color: #556;
                font-size: 13px;
            }
            .depo-preview-empty .icon {
                font-size: 38px;
                display: block;
                margin-bottom: 12px;
                opacity: 0.4;
            }
            .depo-preview-empty .hint {
                margin-top: 8px;
                font-size: 11px;
                color: #445;
                font-style: italic;
            }

            .depo-preview-status {
                padding: 8px 16px;
                background: rgba(15, 18, 25, 0.5);
                border-top: 1px solid rgba(100, 140, 220, 0.1);
                color: #556;
                font-size: 10px;
                text-align: center;
            }
        `;
        document.head.appendChild(style);
    };

    // ==================== INTERCEPT DEPO ====================
    const setupIntercept = () => {
        const original = Engine.communication.parseJSON;
        Engine.communication.parseJSON = function (data) {
            const result = original.apply(this, arguments);

            try {
                if (data && data.depo && typeof data.depo.size === 'number') {
                    tryAddDepoButton();
                }

                if (data && data.depo_opentabs && data.item) {
                        collectDepoOutfitsAndPets();
                        tryAddDepoButton();
                }
            } catch (e) {
                console.error('[DepoPreview] Intercept error:', e);
            }

            return result;
        };
    };

    // ==================== COLLECT ITEMS ====================
    const collectDepoOutfitsAndPets = () => {
        collectedOutfits = [];
        collectedPets = [];

        if (!Engine.items || !Engine.items.fetchLocationItems) return;

        const depoItems = Engine.items.fetchLocationItems('d');

        for (const item of depoItems) {
            // cl 30 = outfits
            if (item.cl === 30) {
                if (typeof item.issetOutfitStat === 'function' && item.issetOutfitStat()) {
                    const outfitStat = item.getOutfitStat();
                    const parts = outfitStat.split(',');
                    collectedOutfits.push({
                        id: item.id,
                        name: item.name,
                        path: parts[1] || parts[0],
                        item: item
                    });
                } else if (typeof item.issetOutfit_selectorStat === 'function' && item.issetOutfit_selectorStat()) {
                    const selectorStat = item.getOutfit_selectorStat();
                    const outfits = selectorStat.split('|');
                    outfits.shift();
                    for (let i = 0; i < outfits.length; i++) {
                        const d = outfits[i].split(',');
                        collectedOutfits.push({
                            id: item.id,
                            name: item.name + (outfits.length > 1 ? ` (${i + 1})` : ''),
                            path: d[0],
                            item: item
                        });
                    }
                } else {
                    const stat = typeof item.stat === 'string' ? item.stat : '';
                    const outfitMatch = stat.match(/outfit=([^;]+)/);
                    if (outfitMatch) {
                        const parts = outfitMatch[1].split(',');
                        collectedOutfits.push({
                            id: item.id,
                            name: item.name,
                            path: parts[1] || parts[0],
                            item: item
                        });
                    }
                }
            }

            // cl 31 = pets
            if (item.cl === 31) {
                if (typeof item.issetPetStat === 'function' && item.issetPetStat()) {
                    const petStat = item.getPetStat();
                    const parts = petStat.split(',');
                    collectedPets.push({
                        id: item.id,
                        name: parts[0] || item.name,
                        path: parts[1],
                        petStat: petStat,
                        item: item
                    });
                } else {
                    const stat = typeof item.stat === 'string' ? item.stat : '';
                    const petMatch = stat.match(/pet=([^;]+)/);
                    if (petMatch) {
                        const parts = petMatch[1].split(',');
                        collectedPets.push({
                            id: item.id,
                            name: parts[0] || item.name,
                            path: parts[1],
                            petStat: petMatch[1],
                            item: item
                        });
                    }
                }
            }
        }
    };

    // ==================== DEPO BUTTON ====================
    const tryAddDepoButton = () => {
        if (!Engine.depo || !Engine.depo.wnd || !Engine.depo.wnd.$) return;

        const $depoWnd = Engine.depo.wnd.$;

        // Usuń stary przycisk jeśli istnieje
        $('#depo-outfits-preview-btn').remove();

        collectDepoOutfitsAndPets();

        // Stwórz przycisk w stylu Margonem (button small green)
        const $btn = $('<div>')
            .attr('id', 'depo-outfits-preview-btn')
            .addClass('button small green')
            .html('<span class="label">🎭 Outfity / Maskotki</span>')
            .css({
                position: 'absolute',
                left: '10px',
                top: '2px',
                cursor: 'pointer',
                'z-index': 15,
                'user-select': 'none'
            })
            .on('mousedown pointerdown', (e) => {
                e.stopPropagation(); // Zapobiegaj przeciąganiu okna przy kliknięciu w button
            })
            .on('click', (e) => {
                e.stopPropagation();
                openPreviewWindow();
            });

        // Dodaj do paska z tytułem okna depo (.header-label-positioner)
        const $headerPos = $depoWnd.find('.header-label-positioner');
        if ($headerPos.length) {
            $headerPos.append($btn);
        } else {
            // Fallback: dodaj bezpośrednio na górę okna depo
            $btn.css({ top: '-32px', left: '10px' });
            $depoWnd.append($btn);
        }
    };

    // ==================== LAZY OBSERVER ====================
    const setupCardObserver = (scrollContainer) => {
        if (cardObserver) {
            cardObserver.disconnect();
        }

        cardObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const cardEl = entry.target;
                const canvasWrapper = cardEl.querySelector('.canvas-wrapper');
                if (!canvasWrapper) return;

                if (entry.isIntersecting) {
                    if (!activeCardCanvases.has(cardEl)) {
                        mountCardCharacter(cardEl, canvasWrapper);
                    }
                } else {
                    if (activeCardCanvases.has(cardEl)) {
                        unmountCardCharacter(cardEl, canvasWrapper);
                    }
                }
            });
        }, {
            root: scrollContainer,
            rootMargin: '120px 0px 120px 0px'
        });
    };

    const mountCardCharacter = (cardEl, canvasWrapper) => {
        const itemType = cardEl.dataset.type;
        const path = cardEl.dataset.path;
        const actions = cardEl.dataset.actions || '';

        try {
            const drawSystem = itemType === 'pet' ? 'PET' : 'PLAYER_OUTFIT';
            const options = {
                drawSystem: drawSystem,
                path: path
            };
            if (actions) {
                options.actions = actions;
            }

            const wrapper = Engine.canvasCharacterWrapperManager.addCharacter(options);
            if (wrapper) {
                const wrapperId = wrapper.getId();
                activeCardCanvases.set(cardEl, wrapperId);
                const canvas = wrapper.getCanvas();
                if (itemType === 'outfit') $(canvas).addClass('outfit');
                canvasWrapper.appendChild(canvas);
            }
        } catch (e) {
            console.warn('[DepoPreview] mount character error:', e);
        }
    };

    const unmountCardCharacter = (cardEl, canvasWrapper) => {
        const wrapperId = activeCardCanvases.get(cardEl);
        if (wrapperId !== undefined) {
            try {
                Engine.canvasCharacterWrapperManager.removeCharacter(wrapperId);
            } catch (e) { /* ignore */ }
            activeCardCanvases.delete(cardEl);
        }
        $(canvasWrapper).empty();
    };

    const clearAllMountedCharacters = () => {
        if (cardObserver) {
            cardObserver.disconnect();
        }
        for (const [cardEl, wrapperId] of activeCardCanvases.entries()) {
            try {
                Engine.canvasCharacterWrapperManager.removeCharacter(wrapperId);
            } catch (e) { /* ignore */ }
            const canvasWrapper = cardEl.querySelector('.canvas-wrapper');
            if (canvasWrapper) $(canvasWrapper).empty();
        }
        activeCardCanvases.clear();
    };

    // ==================== PREVIEW WINDOW ====================
    const openPreviewWindow = () => {
        if (previewWindow) closePreviewWindow();

        collectDepoOutfitsAndPets();

        const $overlay = $('<div>', { class: 'depo-preview-overlay' });
        $overlay.on('click', (e) => {
            if (e.target === $overlay[0]) closePreviewWindow();
        });

        const $window = $('<div>', { class: 'depo-preview-window' });

        const $header = $('<div>', { class: 'depo-preview-header' });
        const $title = $('<div>', { class: 'depo-preview-title' }).text('Podgląd Outfitów i Maskotek');
        const $close = $('<button>', { class: 'depo-preview-close' }).text('✕');
        $close.on('click', closePreviewWindow);
        $header.append($title, $close);

        const $tabs = $('<div>', { class: 'depo-preview-tabs' });
        const $tabOutfits = $('<div>', { class: 'depo-preview-tab active' })
            .html(`Outfity <span class="count">${collectedOutfits.length}</span>`);
        const $tabPets = $('<div>', { class: 'depo-preview-tab' })
            .html(`Maskotki <span class="count">${collectedPets.length}</span>`);

        $tabs.append($tabOutfits, $tabPets);

        const $body = $('<div>', { class: 'depo-preview-body' });
        const $status = $('<div>', { class: 'depo-preview-status' })
            .text('Animacje są ładowane podczas przewijania listy.');

        $window.append($header, $tabs, $body, $status);
        $overlay.append($window);
        $('body').append($overlay);

        previewWindow = $overlay;

        $body.on('wheel', (e) => e.stopPropagation());

        setupCardObserver($body[0]);

        $tabOutfits.on('click', () => {
            if ($tabOutfits.hasClass('active')) return;
            $tabOutfits.addClass('active');
            $tabPets.removeClass('active');
            renderOutfits($body);
        });

        $tabPets.on('click', () => {
            if ($tabPets.hasClass('active')) return;
            $tabPets.addClass('active');
            $tabOutfits.removeClass('active');
            renderPets($body);
        });

        renderOutfits($body);

        $(document).on('keydown.depoPreview', (e) => {
            if (e.key === 'Escape') closePreviewWindow();
        });
    };

    const closePreviewWindow = () => {
        clearAllMountedCharacters();

        if (previewWindow) {
            previewWindow.remove();
            previewWindow = null;
        }

        $(document).off('keydown.depoPreview');
    };

    // ==================== RENDER OUTFITS ====================
    const renderOutfits = ($body) => {
        clearAllMountedCharacters();
        $body.empty();
        setupCardObserver($body[0]);

        if (collectedOutfits.length === 0) {
            $body.append(
                $('<div>', { class: 'depo-preview-empty' }).html(
                    '<span class="icon">👔</span>' +
                    'Brak outfitów w depozycie' +
                    '<div class="hint">Otwórz zakładki depo z outfitami, aby załadować przedmioty</div>'
                )
            );
            return;
        }

        const $grid = $('<div>', { class: 'depo-preview-grid' });

        for (const outfit of collectedOutfits) {
            const $card = createCardElement('outfit', outfit);
            $grid.append($card);
            cardObserver.observe($card[0]);
        }

        $body.append($grid);
    };

    // ==================== RENDER PETS ====================
    const renderPets = ($body) => {
        clearAllMountedCharacters();
        $body.empty();
        setupCardObserver($body[0]);

        if (collectedPets.length === 0) {
            $body.append(
                $('<div>', { class: 'depo-preview-empty' }).html(
                    '<span class="icon">🐾</span>' +
                    'Brak maskotek w depozycie' +
                    '<div class="hint">Otwórz zakładki depo z maskotkami, aby załadować przedmioty</div>'
                )
            );
            return;
        }

        const $grid = $('<div>', { class: 'depo-preview-grid' });

        for (const pet of collectedPets) {
            const $card = createCardElement('pet', pet);
            $grid.append($card);
            cardObserver.observe($card[0]);
        }

        $body.append($grid);
    };

    // ==================== CREATE CARD ====================
    const createCardElement = (type, data) => {
        const $card = $('<div>', { class: 'depo-preview-card' });
        $card.attr('data-type', type);
        $card.attr('data-path', data.path);

        if (type === 'pet' && data.petStat) {
            const parts = data.petStat.split(',');
            if (parts.length > 2) {
                $card.attr('data-actions', parts[parts.length - 1]);
            }
        }

        const $canvasWrapper = $('<div>', { class: 'canvas-wrapper' });

        const $iconWrapper = $('<div>', { class: 'item-icon-wrapper' });
        try {
            const viewData = Engine.items.createViewIcon(data.id, Engine.itemsViewData.DEPO_ITEM_VIEW);
            if (viewData && viewData[0]) {
                const $icon = viewData[0];
                $icon.css({
                    position: 'relative',
                    left: 'auto',
                    top: 'auto'
                });
                $iconWrapper.append($icon);
            }
        } catch (e) {
            console.warn('[DepoPreview] createViewIcon error:', e);
        }

        const $name = $('<div>', { class: 'card-name' }).text(data.name).attr('title', data.name);

        $card.append($canvasWrapper, $iconWrapper, $name);

        try {
            $card.tip(data.item ? data.item.tip : data.name);
        } catch (e) { /* ignore */ }

        return $card;
    };

    // ==================== INIT ====================
    const waitForGame = setInterval(() => {
        if (typeof Engine !== 'undefined' && Engine.hero && Engine.hero.d && Engine.hero.d.id &&
            Engine.communication && Engine.items && Engine.canvasCharacterWrapperManager) {
            clearInterval(waitForGame);
            initAddon();
        }
    }, 500);

    function initAddon() {
        injectStyles();
        setupIntercept();

        if (Engine.depo && Engine.depo.wnd && Engine.depo.wnd.$) {
            tryAddDepoButton();
            collectDepoOutfitsAndPets();
        }
    }
})();
