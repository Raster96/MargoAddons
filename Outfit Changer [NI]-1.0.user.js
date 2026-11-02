// ==UserScript==
// @name         Outfit Changer [NI]
// @author       You
// @description  Zmienia outfit postaci w grze Margonem (NI), wraz z animacjami. 
// @version      1.0
// @match        *://*.margonem.pl/
// @exclude      *://www.margonem.pl/*
// @exclude      *://new.margonem.pl/*
// @exclude      *://forum.margonem.pl/*
// @exclude      *://commons.margonem.pl/*
// @exclude      *://dev-commons.margonem.pl/*
// @icon         https://www.google.com/s2/favicons?domain=margonem.pl
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @require      https://cdn.jsdelivr.net/gh/buzzfeed/libgif-js@master/libgif.js
// ==/UserScript==

(function () {
    'use strict';

    const LOG = '[OutfitChanger]';
    const STORAGE_KEY = 'oc_url';
    const CACHE_KEY = 'oc_cache';

    // Obsługa okna dla Tampermonkey (sandbox vs page context)
    const _win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let Engine = _win.Engine || (typeof window !== 'undefined' ? window.Engine : undefined);
    let $ = _win.$ || (typeof window !== 'undefined' ? window.$ : undefined);

    // ==================== PARSER OPÓŹNIEŃ Z BINARNEGO GIF ====================

    function extractGifDelays(arrayBuffer) {
        const d = new Uint8Array(arrayBuffer);
        const sig = String.fromCharCode(d[0], d[1], d[2], d[3], d[4], d[5]);
        if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('Nie GIF: ' + sig);

        let i = 13;
        const gctFlag = (d[10] >> 7) & 1;
        if (gctFlag) i += 3 * (1 << ((d[10] & 7) + 1));

        const delays = [];
        while (i < d.length) {
            if (d[i] === 0x21) {
                if (d[i + 1] === 0xF9 && d[i + 2] === 0x04) {
                    delays.push((d[i + 4] | (d[i + 5] << 8)) || 10);
                    i += 8;
                } else {
                    i += 2;
                    while (i < d.length && d[i] !== 0) i += d[i] + 1;
                    i++;
                }
            } else if (d[i] === 0x2C) {
                const flags = d[i + 9];
                i += 10;
                if ((flags >> 7) & 1) i += 3 * (1 << ((flags & 7) + 1));
                i++;
                while (i < d.length && d[i] !== 0) i += d[i] + 1;
                i++;
            } else if (d[i] === 0x3B) {
                break;
            } else {
                i++;
            }
        }
        return delays;
    }

    // ==================== PARSER OBRAZKÓW ====================

    /**
     * Sprawdza czy URL to GIF czy statyczny obraz (PNG, JPG, etc.)
     */
    function getImageType(url) {
        const lower = url.toLowerCase();
        // Data URL - sprawdź MIME type
        if (lower.startsWith('data:')) {
            if (lower.includes('data:image/gif')) return 'gif';
            return 'static';
        }
        // Zwykły URL - sprawdź rozszerzenie
        if (lower.includes('.gif')) return 'gif';
        if (lower.includes('.png') || lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.webp')) return 'static';
        return 'unknown';
    }
    
    /**
     * Sprawdza czy URL jest Data URL
     */
    function isDataURL(url) {
        return url.startsWith('data:');
    }

    /**
     * Parser dla statycznych obrazków (PNG, JPG, etc.)
     * Zakłada sprite sheet 4 kolumny x 4 rzędy (standardowy layout Margonem)
     */
    function parseStaticImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                try {
                    const frameW = img.width / 4;
                    const frameH = img.height / 4;

                    // Dla statycznego obrazu tworzymy tylko 1 klatkę z domyślnym opóźnieniem
                    const frames = [{ delay: 10 }];

                    // Konwertujemy na canvas aby mieć spójny format danych
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    const dataUrl = canvas.toDataURL();
                    const spriteImg = new Image();
                    spriteImg.onload = () => {
                        resolve({
                            hdr: { width: img.width, height: img.height },
                            frames: frames,
                            img: dataUrl,
                            image: spriteImg,
                            isStatic: true
                        });
                    };
                    spriteImg.onerror = () => reject(new Error('Błąd ładowania sprite'));
                    spriteImg.src = dataUrl;
                } catch (e) {
                    reject(new Error('Błąd przetwarzania: ' + e.message));
                }
            };

            img.onerror = () => reject(new Error('Błąd ładowania obrazu'));
            img.src = url;

            setTimeout(() => reject(new Error('Timeout 15s')), 15000);
        });
    }

    /**
     * Parser dla animowanych GIF
     */
    function parseGif(url) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            const fail = (msg) => { if (!resolved) { resolved = true; reject(new Error(msg)); } };

            // Jeśli to Data URL, użyj go bezpośrednio zamiast fetch
            const fetchPromise = isDataURL(url) 
                ? fetch(url).then(r => r.arrayBuffer())
                : fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });

            fetchPromise.then(buffer => {
                    const delays = extractGifDelays(buffer);

                    const container = document.createElement('div');
                    container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
                    document.body.appendChild(container);
                    const imgEl = document.createElement('img');
                    imgEl.crossOrigin = 'anonymous';
                    container.appendChild(imgEl);
                    imgEl.src = url;
                    const cleanup = () => { try { container.remove(); } catch (_) {} };

                    const gif = new SuperGif({
                        gif: imgEl,
                        auto_play: false,
                        draw_while_loading: false,
                        show_progress_bar: false,
                        on_error: (err) => { cleanup(); fail('libgif: ' + err); }
                    });

                    gif.load(() => {
                        if (resolved) return;
                        try {
                            const numFrames = gif.get_length();
                            if (!numFrames) { cleanup(); fail('0 klatek'); return; }

                            const fc = gif.get_canvas();
                            const frameW = fc.width, frameH = fc.height;

                            const sheet = document.createElement('canvas');
                            sheet.width = frameW;
                            sheet.height = frameH * numFrames;
                            const sCtx = sheet.getContext('2d');
                            const frames = [];

                            for (let i = 0; i < numFrames; i++) {
                                gif.move_to(i);
                                frames.push({ delay: delays[i] || 10 });
                                sCtx.drawImage(fc, 0, i * frameH);
                            }

                            const dataUrl = sheet.toDataURL();
                            const spriteImg = new Image();
                            spriteImg.onload = () => {
                                resolved = true;
                                cleanup();
                                resolve({
                                    hdr: { width: frameW, height: frameH },
                                    frames: frames,
                                    img: dataUrl,
                                    image: spriteImg,
                                    isStatic: false
                                });
                            };
                            spriteImg.onerror = () => { cleanup(); fail('Błąd sprite'); };
                            spriteImg.src = dataUrl;
                        } catch (e) { cleanup(); fail(e.message); }
                    });
                })
                .catch(e => fail('Fetch: ' + e.message));

            setTimeout(() => fail('Timeout 15s'), 15000);
        });
    }

    /**
     * Uniwersalny parser - automatycznie wybiera parser na podstawie typu pliku
     */
    function parseImage(url) {
        const type = getImageType(url);

        if (type === 'gif') {
            return parseGif(url);
        } else if (type === 'static') {
            return parseStaticImage(url);
        } else {
            return parseStaticImage(url);
        }
    }

    // ==================== ZASTOSOWANIE OUTFITU ====================

    function applyOutfit(gifData) {
        if (!Engine || !Engine.hero) return;
        const hero = Engine.hero;
        const fw = gifData.hdr.width / 4;
        const fh = gifData.hdr.height / 4;

        const outfitData = {
            kind: 'original',
            fw: fw,
            fh: fh,
            halffw: fw / 2,
            halffh: fh / 2,
            frames: gifData.frames,
            activeFrame: 0,
            sprite: gifData.image
        };

        hero.setOutfitData(outfitData);
        hero.setOnloadProperImg(true);

        const typeInfo = gifData.isStatic ? 'statyczny' : 'animowany';
    }

    // ==================== INTERCEPT (przeładowania mapy) ====================

    let activeOutfitData = null;

    const intercept = (obj, key, cb, original = obj[key]) => {
        obj[key] = (...args) => {
            const result = original.apply(obj, args);
            cb(...args);
            return result;
        };
    };

    let interceptInstalled = false;

    function setupIntercept() {
        if (interceptInstalled) return;
        interceptInstalled = true;

        intercept(Engine.communication, 'parseJSON', (data) => {
            if (!data) return;
            const isMapOrInit = !!(data.town || data.gw || data.npc_tpls || data.npcs);
            const isHeroImgChange = !!(data.h && data.h.img);

            if (isMapOrInit || isHeroImgChange) {
                if (activeOutfitData) {
                    setTimeout(reapplyAll, 200);
                }
            }
        });
    }

    function reapplyAll() {
        if (activeOutfitData && Engine && Engine.hero) {
            applyOutfit(activeOutfitData);
        }
        ensureButton();
    }

    // ==================== STORAGE (GM) ====================

    let ocPanel = null;

    function ensureButton() {
        if (document.getElementById('oc-toggle-btn')) return;

        const panel = ocPanel;
        const btn = document.createElement('div');
        btn.id = 'oc-toggle-btn';
        btn.innerHTML = '🎭';
        btn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 32px;
            height: 32px;
            background: rgba(0, 0, 0, 0.85);
            border: 1px solid rgba(255, 128, 0, 0.6);
            border-radius: 50%;
            cursor: move;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            color: #ff8000;
            box-shadow: 0 0 5px rgba(255, 128, 0, 0.3);
            transition: box-shadow 0.2s ease, transform 0.2s ease;
            user-select: none;
        `;

        const savedPos = GM_getValue('oc_btn_pos', { bottom: 20, right: 20 });
        btn.style.bottom = savedPos.bottom + 'px';
        btn.style.right = savedPos.right + 'px';

        btn.addEventListener('click', (e) => {
            if (!hasMoved) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
        });

        btn.addEventListener('mouseenter', () => {
            if (!hasMoved) {
                btn.style.transform = 'scale(1.05)';
                btn.style.boxShadow = '0 0 8px rgba(255, 128, 0, 0.5)';
            }
        });

        btn.addEventListener('mouseleave', () => {
            if (!hasMoved) {
                btn.style.transform = 'scale(1)';
                btn.style.boxShadow = '0 0 5px rgba(255, 128, 0, 0.3)';
            }
        });

        let hasMoved = false;
        let startX, startY, startBottom, startRight;

        btn.addEventListener('mousedown', (e) => {
            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            startBottom = parseInt(btn.style.bottom);
            startRight = parseInt(btn.style.right);
            btn.style.transition = 'none';

            const onMouseMove = (e) => {
                const deltaX = startX - e.clientX;
                const deltaY = startY - e.clientY;

                if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
                    hasMoved = true;
                    const newRight = Math.max(0, Math.min(window.innerWidth - 32, startRight + deltaX));
                    const newBottom = Math.max(0, Math.min(window.innerHeight - 32, startBottom + deltaY));

                    btn.style.right = newRight + 'px';
                    btn.style.bottom = newBottom + 'px';
                    btn.style.cursor = 'grabbing';
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                btn.style.cursor = 'move';
                btn.style.transition = 'box-shadow 0.2s ease, transform 0.2s ease';

                if (hasMoved) {
                    GM_setValue('oc_btn_pos', {
                        bottom: parseInt(btn.style.bottom),
                        right: parseInt(btn.style.right)
                    });
                }

                hasMoved = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        document.body.appendChild(btn);
    }

    function saveUrl(outfitUrl) {
        try {
            GM_setValue(STORAGE_KEY, outfitUrl);
        } catch (e) {
            console.error(LOG, 'Błąd zapisu GM storage:', e);
        }
    }

    function loadUrl() {
        try {
            return GM_getValue(STORAGE_KEY, '');
        } catch (e) {
            console.error(LOG, 'Błąd odczytu GM storage:', e);
            return '';
        }
    }

    // ==================== CACHE SPRITESHEET (GM) ====================

    function getCachedGif() {
        try {
            const val = GM_getValue(CACHE_KEY, null);
            if (val) return typeof val === 'string' ? JSON.parse(val) : val;
        } catch (_) {}
        return null;
    }

    function setCachedGif(url, gifData) {
        try {
            GM_setValue(CACHE_KEY, JSON.stringify({
                url: url,
                hdr: gifData.hdr,
                frames: gifData.frames,
                img: gifData.img,
                isStatic: gifData.isStatic || false
            }));
        } catch (e) {
            console.warn(LOG, 'Cache save error:', e);
        }
    }

    function loadImageSync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = src;
        });
    }

    async function parseGifCached(url) {
        const cached = getCachedGif();
        if (cached && cached.url === url) {
            const img = await loadImageSync(cached.img);
            return {
                hdr: cached.hdr,
                frames: cached.frames,
                img: cached.img,
                image: img,
                isStatic: cached.isStatic || false
            };
        }
        const data = await parseImage(url); // Zmienione z parseGif na parseImage
        setCachedGif(url, data);
        return data;
    }

    // ==================== PRELOAD Z CACHE ====================

    let preloadedOutfit = null;

    function preloadFromCache() {
        const saved = loadUrl();
        if (saved) {
            const cached = getCachedGif();
            if (cached && cached.url === saved) {
                const img = new Image();
                img.onload = () => {
                    preloadedOutfit = {
                        hdr: cached.hdr,
                        frames: cached.frames,
                        img: cached.img,
                        image: img,
                        isStatic: cached.isStatic || false
                    };
                    tryApplyPreloaded();
                };
                img.onerror = (e) => {
                    console.error(LOG, 'Błąd ładowania obrazu z cache:', e);
                };
                img.src = cached.img;
            } else {
                if (cached) {
                }
            }
        } else {
        }
    }

    function tryApplyPreloaded() {
        if (!Engine || !Engine.hero) return;
        if (preloadedOutfit && !activeOutfitData) {
            activeOutfitData = preloadedOutfit;
            applyOutfit(preloadedOutfit);
        }
    }

    preloadFromCache();

    // ==================== UI ====================

    function createUI() {
        const saved = loadUrl();

        const style = document.createElement('style');
        style.textContent = `
            #oc-panel {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(20, 20, 30, 0.95);
                border: 1px solid #555;
                border-radius: 8px;
                padding: 16px;
                z-index: 99999;
                color: #ddd;
                font-family: Arial, sans-serif;
                font-size: 13px;
                min-width: 420px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                display: none;
            }
            #oc-panel .oc-title {
                font-size: 15px;
                font-weight: bold;
                margin-bottom: 12px;
                color: #fff;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            #oc-panel .oc-close {
                cursor: pointer;
                font-size: 18px;
                color: #999;
                background: none;
                border: none;
                padding: 0 4px;
            }
            #oc-panel .oc-close:hover { color: #fff; }
            #oc-panel .oc-row {
                margin-bottom: 10px;
            }
            #oc-panel .oc-row label {
                display: block;
                margin-bottom: 4px;
                color: #aaa;
                font-size: 12px;
            }
            #oc-panel .oc-row input {
                width: 100%;
                box-sizing: border-box;
                padding: 6px 8px;
                background: #1a1a2a;
                border: 1px solid #444;
                border-radius: 4px;
                color: #eee;
                font-size: 12px;
            }
            #oc-panel .oc-row input:focus {
                outline: none;
                border-color: #7a7;
            }
            #oc-panel .oc-buttons {
                display: flex;
                gap: 8px;
                margin-top: 12px;
            }
            #oc-panel .oc-buttons button {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: bold;
                transition: all 0.2s;
            }
            #oc-panel .oc-buttons button:hover {
                opacity: 0.8;
            }
            #oc-panel .oc-btn-apply {
                background: #4a7;
                color: #fff;
            }
            #oc-panel .oc-btn-reset {
                background: #d44;
                color: #fff;
            }
            #oc-panel .oc-dropzone {
                border: 2px dashed #666;
                border-radius: 8px;
                padding: 30px;
                text-align: center;
                background: rgba(255, 255, 255, 0.02);
                cursor: pointer;
                transition: all 0.3s;
                margin-bottom: 10px;
            }
            #oc-panel .oc-dropzone:hover {
                border-color: #7a7;
                background: rgba(119, 170, 119, 0.1);
            }
            #oc-panel .oc-dropzone.drag-over {
                border-color: #4a7;
                background: rgba(68, 170, 119, 0.2);
                border-style: solid;
            }
            #oc-panel .oc-dropzone-icon {
                font-size: 40px;
                margin-bottom: 10px;
            }
            #oc-panel .oc-dropzone-text {
                color: #aaa;
                font-size: 13px;
            }
            #oc-panel .oc-dropzone-subtext {
                color: #777;
                font-size: 11px;
                margin-top: 5px;
            }
            #oc-panel .oc-file-input {
                display: none;
            }
            #oc-panel .oc-divider {
                text-align: center;
                margin: 15px 0;
                position: relative;
            }
            #oc-panel .oc-divider::before {
                content: '';
                position: absolute;
                left: 0;
                right: 0;
                top: 50%;
                height: 1px;
                background: #444;
            }
            #oc-panel .oc-divider span {
                background: rgba(20, 20, 30, 0.95);
                padding: 0 10px;
                position: relative;
                color: #888;
                font-size: 11px;
                text-transform: uppercase;
            }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'oc-panel';
        panel.innerHTML = `
            <div class="oc-title">
                <span>🎭 Outfit Changer</span>
                <button class="oc-close">✕</button>
            </div>
            
            <div class="oc-dropzone" id="oc-dropzone">
                <div class="oc-dropzone-icon">📁</div>
                <div class="oc-dropzone-text">Przeciągnij plik tutaj lub kliknij aby wybrać</div>
                <div class="oc-dropzone-subtext">GIF, PNG, JPG, WebP (sprite sheet 4×4)</div>
            </div>
            <input type="file" id="oc-file-input" class="oc-file-input" accept=".gif,.png,.jpg,.jpeg,.webp,image/gif,image/png,image/jpeg,image/webp">
            
            <div class="oc-divider"><span>lub podaj link</span></div>
            
            <div class="oc-row">
                <label>Link do obrazu:</label>
                <input type="text" id="oc-outfit-url" placeholder="https://example.com/outfit.gif" value="${saved || ''}">
            </div>
            <div class="oc-buttons">
                <button class="oc-btn-apply">Zastosuj Outfit</button>
                <button class="oc-btn-reset">Resetuj</button>
            </div>
        `;

        document.body.appendChild(panel);
        ocPanel = panel;

        panel.querySelector('.oc-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        // ==================== DRAG & DROP ====================
        
        const dropzone = panel.querySelector('#oc-dropzone');
        const fileInput = panel.querySelector('#oc-file-input');
        
        // Kliknięcie na dropzone otwiera wybór pliku
        dropzone.addEventListener('click', () => {
            fileInput.click();
        });
        
        // Wybór pliku przez input
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await handleFile(file);
            }
        });
        
        // Zapobiegaj domyślnemu zachowaniu przeglądarki
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        
        // Wizualne wyróżnienie podczas przeciągania
        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => {
                dropzone.classList.add('drag-over');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => {
                dropzone.classList.remove('drag-over');
            });
        });
        
        // Obsługa upuszczenia pliku
        dropzone.addEventListener('drop', async (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                await handleFile(files[0]);
            }
        });
        
        // Funkcja obsługująca plik
        async function handleFile(file) {
            // Sprawdź typ pliku
            const validTypes = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'];
            if (!validTypes.includes(file.type)) {
                alert('Nieobsługiwany typ pliku! Użyj GIF, PNG, JPG lub WebP.');
                return;
            }
            
            try {
                const btn = panel.querySelector('.oc-btn-apply');
                const originalText = btn.textContent;
                btn.textContent = 'Ładowanie...';
                btn.disabled = true;
                
                // Konwertuj plik na Data URL
                const dataUrl = await fileToDataURL(file);
                
                // Parsuj jako obraz
                const imageData = await parseImageFromDataURL(dataUrl, file.type);
                activeOutfitData = imageData;
                applyOutfit(imageData);
                
                // WAŻNE: Zapisz imageData.img (przetworzony Data URL) 
                // i wyświetl go również w polu input
                saveUrl(imageData.img);
                setCachedGif(imageData.img, imageData);
                panel.querySelector('#oc-outfit-url').value = imageData.img;
                
                btn.textContent = '✓ Zastosowano';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 1500);
                
            } catch (e) {
                console.error(LOG, 'Błąd przetwarzania pliku:', e);
                alert('Błąd: ' + e.message);
                const btn = panel.querySelector('.oc-btn-apply');
                btn.textContent = 'Zastosuj Outfit';
                btn.disabled = false;
            }
        }
        
        // Konwersja pliku na Data URL
        function fileToDataURL(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(new Error('Błąd odczytu pliku'));
                reader.readAsDataURL(file);
            });
        }
        
        // Parser obrazu z Data URL
        function parseImageFromDataURL(dataUrl, mimeType) {
            return new Promise((resolve, reject) => {
                const isGif = mimeType === 'image/gif';
                
                if (isGif) {
                    // Dla GIF użyj pełnego parsera z animacjami
                    parseGifFromDataURL(dataUrl).then(resolve).catch(reject);
                } else {
                    // Dla statycznych obrazków
                    parseStaticImageFromDataURL(dataUrl).then(resolve).catch(reject);
                }
            });
        }
        
        // Parser GIF z Data URL
        function parseGifFromDataURL(dataUrl) {
            return new Promise((resolve, reject) => {
                // Konwertuj Data URL na Blob
                fetch(dataUrl)
                    .then(r => r.arrayBuffer())
                    .then(buffer => {
                        const delays = extractGifDelays(buffer);
                        
                        const container = document.createElement('div');
                        container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
                        document.body.appendChild(container);
                        const imgEl = document.createElement('img');
                        container.appendChild(imgEl);
                        imgEl.src = dataUrl;
                        const cleanup = () => { try { container.remove(); } catch (_) {} };
                        
                        const gif = new SuperGif({
                            gif: imgEl,
                            auto_play: false,
                            draw_while_loading: false,
                            show_progress_bar: false,
                            on_error: (err) => { cleanup(); reject(new Error('libgif: ' + err)); }
                        });
                        
                        gif.load(() => {
                            try {
                                const numFrames = gif.get_length();
                                if (!numFrames) { cleanup(); reject(new Error('0 klatek')); return; }
                                
                                const fc = gif.get_canvas();
                                const frameW = fc.width, frameH = fc.height;
                                
                                const sheet = document.createElement('canvas');
                                sheet.width = frameW;
                                sheet.height = frameH * numFrames;
                                const sCtx = sheet.getContext('2d');
                                const frames = [];
                                
                                for (let i = 0; i < numFrames; i++) {
                                    gif.move_to(i);
                                    frames.push({ delay: delays[i] || 10 });
                                    sCtx.drawImage(fc, 0, i * frameH);
                                }
                                
                                const sheetDataUrl = sheet.toDataURL();
                                const spriteImg = new Image();
                                spriteImg.onload = () => {
                                    cleanup();
                                    resolve({
                                        hdr: { width: frameW, height: frameH },
                                        frames: frames,
                                        img: sheetDataUrl,
                                        image: spriteImg,
                                        isStatic: false
                                    });
                                };
                                spriteImg.onerror = () => { cleanup(); reject(new Error('Błąd sprite')); };
                                spriteImg.src = sheetDataUrl;
                            } catch (e) { cleanup(); reject(e); }
                        });
                    })
                    .catch(e => reject(new Error('Błąd konwersji: ' + e.message)));
            });
        }
        
        // Parser statycznego obrazu z Data URL
        function parseStaticImageFromDataURL(dataUrl) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                
                img.onload = () => {
                    try {
                        const frameW = img.width / 4;
                        const frameH = img.height / 4;
                        const frames = [{ delay: 10 }];
                        
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        
                        const canvasDataUrl = canvas.toDataURL();
                        const spriteImg = new Image();
                        spriteImg.onload = () => {
                            resolve({
                                hdr: { width: img.width, height: img.height },
                                frames: frames,
                                img: canvasDataUrl,
                                image: spriteImg,
                                isStatic: true
                            });
                        };
                        spriteImg.onerror = () => reject(new Error('Błąd ładowania sprite'));
                        spriteImg.src = canvasDataUrl;
                    } catch (e) {
                        reject(new Error('Błąd przetwarzania: ' + e.message));
                    }
                };
                
                img.onerror = () => reject(new Error('Błąd ładowania obrazu'));
                img.src = dataUrl;
            });
        }

        panel.querySelector('.oc-btn-apply').addEventListener('click', async () => {
            const outfitUrl = panel.querySelector('#oc-outfit-url').value.trim();

            if (!outfitUrl) {
                alert('Podaj link do obrazu (GIF/PNG/JPG)!');
                return;
            }

            try {
                const btn = panel.querySelector('.oc-btn-apply');
                btn.textContent = 'Ładowanie...';
                btn.disabled = true;

                const imageData = await parseGifCached(outfitUrl);
                activeOutfitData = imageData;
                applyOutfit(imageData);
                saveUrl(outfitUrl);

                btn.textContent = '✓ Zastosowano';
                setTimeout(() => {
                    btn.textContent = 'Zastosuj Outfit';
                    btn.disabled = false;
                }, 1500);
            } catch (e) {
                console.error(LOG, 'Błąd parsowania:', e);
                alert('Błąd: ' + e.message);
                const btn = panel.querySelector('.oc-btn-apply');
                btn.textContent = 'Zastosuj Outfit';
                btn.disabled = false;
            }
        });

        panel.querySelector('.oc-btn-reset').addEventListener('click', () => {
            activeOutfitData = null;
            saveUrl('');
            GM_deleteValue(CACHE_KEY);
            panel.querySelector('#oc-outfit-url').value = '';
            alert('Wyczyszczono. Przeładuj grę (F5) aby zobaczyć oryginalny outfit.');
        });

        ensureButton();
    }

    // ==================== INIT ====================

    function waitForEngine() {
        return new Promise((resolve) => {
            const check = () => {
                Engine = _win.Engine || (typeof window !== 'undefined' ? window.Engine : undefined);
                $ = _win.$ || (typeof window !== 'undefined' ? window.$ : undefined);

                if (Engine && Engine.hero && Engine.communication) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    (async function init() {
        await waitForEngine();

        setupIntercept();
        createUI();
        tryApplyPreloaded();
    })();

})();