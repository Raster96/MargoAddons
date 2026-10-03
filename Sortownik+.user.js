// ==UserScript==
// @name         Sortownik+
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Przeglądarka przedmiotów z filtrami definiowanymi przez użytkownika
// @author       You
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // ==================== HELPERS ====================

    const addTip = (element, text) => { $(element).tip(text); };

    // ==================== STORAGE ====================
    const KEYS = {
        filters:  'sortownik_filters',
        pos:      'sortownik_pos',
        active:   'sortownik_active',
        visible:  'sortownik_visible',
        settings: 'sortownik_settings',
        deletedFilters: 'sortownik_deleted_filters',
        togglePos: 'sortownik_toggle_pos',
    };

    const load  = (k, def) => GM_getValue(k, def);
    const save  = (k, v)   => GM_setValue(k, v);

    // ==================== STATE ====================
    let userFilters    = [];
    let deletedFilters = [];
    let currentFilterId = 0;          // 0 = "Wszystko"
    let searchValue    = '';
    let panelEl        = null;
    let toggleBtn      = null;
    let isVisible      = false;
    let isDragging     = false;
    let dragOffset     = { x: 0, y: 0 };
    let isResizing     = false;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let isPanelLocked = false; // Czy okno jest zablokowane przed przesuwaniem
    let settings       = { itemClickMode: 'single', filtersVisible: true, hideGameBags: false, maxHeight: 246, sortMode: 'newest', isPanelLocked: false, panelOpacity: 4, filterRows: 1, filterScale: 100 }; // Domyślne ustawienia - zostaną nadpisane przez load() przy inicjalizacji

    // Hook dla menu kontekstowego - MUSI być zainstalowany PRZED inicjalizacją Engine
        let isFilterSubmenu = false; // Flaga aby wykryć submenu filtrów

        const interval = setInterval(() => {
            if (Engine?.interface?.showPopupMenu) {
                clearInterval(interval);
                const originalShowPopupMenu = Engine.interface.showPopupMenu;

                Engine.interface.showPopupMenu = function (menu, e, onMap) {
                    // Jeśli to submenu filtrów, nie dodawaj nic
                    if (isFilterSubmenu) {
                        isFilterSubmenu = false;
                        return originalShowPopupMenu.call(this, menu, e, onMap);
                    }

                    const itemElement = e.target.closest('.item');
                    const itemId = itemElement?.className.match(/item-id-(\d+)/)?.[1];
                    if (itemId) {
                        const item = Engine.items.getItemById(itemId);

                        // Sprawdź czy już dodaliśmy opcję (żeby nie dodawać wielokrotnie)
                        const alreadyAddedAdd = menu.some(entry =>
                            Array.isArray(entry) && (entry[0] === 'Dodaj do kategorii' || entry[0] === 'Dodaj do filtra')
                        );
                        const alreadyAddedRemove = menu.some(entry =>
                            Array.isArray(entry) && (entry[0] === 'Usuń z kategorii' || entry[0] === 'Usuń z filtra')
                        );

                        // Dodaj opcję tylko jeśli item jest w ekwipunku (loc === 'g')
                        const availableCategories = userFilters.filter(f => f.id !== 0);
                        if (item && item.loc === 'g' && availableCategories.length > 0 && !alreadyAddedAdd && !alreadyAddedRemove) {
                            // Sprawdź w których filtrach jest ten przedmiot (zarówno z itemNames/itemIds jak i z wyrażenia)
                            const filtersWithItem = userFilters.filter(filter => {
                                if (filter.id === 0) return false;
                                return matchesFilter(filter, item);
                            });

                            // Zawsze dodaj "Dodaj do kategorii"
                            menu.splice(3, 0, [
                                'Dodaj do kategorii',
                                (clickEv) => {
                                    // Ustaw flagę że to submenu filtrów
                                    isFilterSubmenu = true;
                                    const targetEv = (clickEv && clickEv.clientX !== undefined) ? clickEv : e;

                                    // Pokaż nowe menu z wyborem kategorii (submenu 2)
                                    const filterMenu = [];
                                    for (const filter of availableCategories) {
                                        filterMenu.push([
                                            filter.name,
                                            (subClickEv) => {
                                                // Ustaw flagę na 3 submenu (wybór Nazwa lub ID)
                                                isFilterSubmenu = true;
                                                const finalEv = (subClickEv && subClickEv.clientX !== undefined) ? subClickEv : targetEv;
                                                const choiceMenu = [
                                                    [
                                                        'Po nazwie',
                                                        () => {
                                                            addItemToFilter(filter.id, item, 'name');
                                                        }
                                                    ],
                                                    [
                                                        'Po ID',
                                                        () => {
                                                            addItemToFilter(filter.id, item, 'id');
                                                        }
                                                    ]
                                                ];
                                                Engine.interface.showPopupMenu(choiceMenu, finalEv, onMap);
                                            }
                                        ]);
                                    }
                                    Engine.interface.showPopupMenu(filterMenu, targetEv, onMap);
                                }
                            ]);

                            // Jeśli przedmiot jest w jakimś filtrze, dodaj też "Usuń z kategorii"
                            if (filtersWithItem.length > 0) {
                                menu.splice(4, 0, [
                                    'Usuń z kategorii',
                                    (clickEv) => {
                                        // Ustaw flagę że to submenu filtrów
                                        isFilterSubmenu = true;
                                        const targetEv = (clickEv && clickEv.clientX !== undefined) ? clickEv : e;

                                        // Pokaż menu z kategoriami gdzie jest ten przedmiot
                                        const filterMenu = [];
                                        for (const filter of filtersWithItem) {
                                            const hasName = filter.itemNames && filter.itemNames.some(name => name.toLowerCase() === item.name.toLowerCase());
                                            const hasId = filter.itemIds && filter.itemIds.some(entry => {
                                                const eid = typeof entry === 'object' && entry !== null ? entry.id : entry;
                                                return String(eid) === String(item.id);
                                            });
                                            const matchesExpr = filter.expression && filter.expression.trim()
                                                ? evalExpr(filter.expression, item)
                                                : false;

                                            // Jeśli przedmiot pasuje do wyrażenia LUB był dodany po obu (Nazwa i ID),
                                            // wyświetlamy submenu wyboru (Nazwa / ID / Oba)
                                            if (matchesExpr || (hasName && hasId)) {
                                                filterMenu.push([
                                                    filter.name,
                                                    (subClickEv) => {
                                                        isFilterSubmenu = true;
                                                        const finalEv = (subClickEv && subClickEv.clientX !== undefined) ? subClickEv : targetEv;
                                                        const choiceMenu = [
                                                            [
                                                                'Po nazwie',
                                                                () => {
                                                                    removeItemFromFilter(filter.id, item, 'name');
                                                                }
                                                            ],
                                                            [
                                                                'Po ID',
                                                                () => {
                                                                    removeItemFromFilter(filter.id, item, 'id');
                                                                }
                                                            ]
                                                        ];
                                                        if (hasName && hasId) {
                                                            choiceMenu.push([
                                                                'Oba',
                                                                () => {
                                                                    removeItemFromFilter(filter.id, item, 'both');
                                                                }
                                                            ]);
                                                        }
                                                        Engine.interface.showPopupMenu(choiceMenu, finalEv, onMap);
                                                    }
                                                ]);
                                            } else if (hasId) {
                                                // Tylko po ID
                                                filterMenu.push([
                                                    filter.name,
                                                    () => {
                                                        removeItemFromFilter(filter.id, item, 'id');
                                                    }
                                                ]);
                                            } else {
                                                // Tylko po nazwie
                                                filterMenu.push([
                                                    filter.name,
                                                    () => {
                                                        removeItemFromFilter(filter.id, item, 'name');
                                                    }
                                                ]);
                                            }
                                        }
                                        Engine.interface.showPopupMenu(filterMenu, targetEv, onMap);
                                    }
                                ]);
                            }

                            // Usuń duplikaty separatorów które mogły się pojawić
                            // (czasami gra wywołuje hook wielokrotnie)
                            let lastWasSeparator = false;
                            const cleanedMenu = [];
                            for (const entry of menu) {
                                const isSeparator = Array.isArray(entry) && entry[0] === '---';
                                if (isSeparator && lastWasSeparator) {
                                    // Pomiń duplikat separatora
                                    continue;
                                }
                                cleanedMenu.push(entry);
                                lastWasSeparator = isSeparator;
                            }
                            // Nadpisz menu oczyszczoną wersją
                            menu.length = 0;
                            menu.push(...cleanedMenu);
                        }
                    }

                    return originalShowPopupMenu.call(this, menu, e, onMap);
                };
            }
        }, 100);

    function addItemToFilter(filterId, itemOrName, mode = 'name') {
        const filter = userFilters.find(f => f.id === filterId);
        if (!filter) return;

        if (!filter.itemNames) filter.itemNames = [];
        if (!filter.itemIds) filter.itemIds = [];
        if (!filter.excludedNames) filter.excludedNames = [];
        if (!filter.excludedIds) filter.excludedIds = [];

        const itemName = typeof itemOrName === 'object' && itemOrName !== null ? itemOrName.name : String(itemOrName);
        const itemId = typeof itemOrName === 'object' && itemOrName !== null ? String(itemOrName.id) : null;

        // Jeśli przedmiot był wykluczony, usuń go z wykluczeń
        if (mode === 'id' && itemId) {
            const exclIdx = filter.excludedIds.findIndex(entry => {
                const eid = typeof entry === 'object' && entry !== null ? entry.id : entry;
                return String(eid) === itemId;
            });
            if (exclIdx > -1) filter.excludedIds.splice(exclIdx, 1);
        } else if (mode === 'name') {
            const exclIdx = filter.excludedNames.findIndex(n => n.toLowerCase() === itemName.toLowerCase());
            if (exclIdx > -1) filter.excludedNames.splice(exclIdx, 1);
        }

        if (mode === 'id') {
            if (!itemId) {
                message('Nie można pobrać ID przedmiotu');
                return;
            }

            const exists = filter.itemIds.some(entry => {
                const eid = typeof entry === 'object' && entry !== null ? entry.id : entry;
                return String(eid) === itemId;
            });

            if (exists) {
                message(`Przedmiot o ID ${itemId} już jest w kategorii "${filter.name}"`);
                return;
            }

            filter.itemIds.push({ id: itemId, name: itemName });
            save(KEYS.filters, userFilters);
            message(`Dodano "${itemName}" (ID: ${itemId}) do kategorii "${filter.name}"`);
        } else {
            if (filter.itemNames.some(name => name.toLowerCase() === itemName.toLowerCase())) {
                message(`Przedmiot "${itemName}" już jest w kategorii "${filter.name}"`);
                return;
            }

            filter.itemNames.push(itemName);
            save(KEYS.filters, userFilters);
            message(`Dodano "${itemName}" (po nazwie) do kategorii "${filter.name}"`);
        }

        // Odśwież listę jeśli aktualnie wyświetlamy ten filtr
        if (currentFilterId === filterId) {
            refreshItems();
        }

        // Odśwież liczniki filtrów
        updateFilterCounts();
    }

    function removeItemFromFilter(filterId, itemOrName, mode = 'both') {
        const filter = userFilters.find(f => f.id === filterId);
        if (!filter) return;

        if (!filter.itemNames) filter.itemNames = [];
        if (!filter.itemIds) filter.itemIds = [];
        if (!filter.excludedNames) filter.excludedNames = [];
        if (!filter.excludedIds) filter.excludedIds = [];

        const itemName = typeof itemOrName === 'object' && itemOrName !== null ? itemOrName.name : String(itemOrName);
        const itemId = typeof itemOrName === 'object' && itemOrName !== null ? String(itemOrName.id) : null;
        const itemObj = typeof itemOrName === 'object' && itemOrName !== null ? itemOrName : null;

        const matchesExpr = itemObj && filter.expression && filter.expression.trim()
            ? evalExpr(filter.expression, itemObj)
            : false;

        let removed = false;

        // Usuń / wyklucz po nazwie
        if (mode === 'both' || mode === 'name') {
            const index = filter.itemNames.findIndex(name => name.toLowerCase() === itemName.toLowerCase());
            if (index > -1) {
                filter.itemNames.splice(index, 1);
                removed = true;
            }

            // Jeśli pasuje do wyrażenia filtra (lub nie był w itemNames), dodajemy do excludedNames
            if (matchesExpr || index === -1) {
                if (!filter.excludedNames.some(name => name.toLowerCase() === itemName.toLowerCase())) {
                    filter.excludedNames.push(itemName);
                    removed = true;
                }
            }
        }

        // Usuń / wyklucz po ID
        if ((mode === 'both' || mode === 'id') && itemId) {
            const index = filter.itemIds.findIndex(entry => {
                const eid = typeof entry === 'object' && entry !== null ? entry.id : entry;
                return String(eid) === itemId;
            });
            if (index > -1) {
                filter.itemIds.splice(index, 1);
                removed = true;
            }

            // Jeśli pasuje do wyrażenia filtra (lub nie był w itemIds), dodajemy do excludedIds
            if (matchesExpr || index === -1) {
                const exists = filter.excludedIds.some(entry => {
                    const eid = typeof entry === 'object' && entry !== null ? entry.id : entry;
                    return String(eid) === itemId;
                });
                if (!exists) {
                    filter.excludedIds.push({ id: itemId, name: itemName });
                    removed = true;
                }
            }
        }

        if (removed) {
            save(KEYS.filters, userFilters);
            let detail = '';
            if (mode === 'name') detail = ' (po nazwie)';
            else if (mode === 'id') detail = ` (ID: ${itemId})`;
            else if (mode === 'both') detail = ' (po nazwie i ID)';

            message(`Usunięto "${itemName}"${detail} z kategorii "${filter.name}"`);

            // Odśwież listę jeśli aktualnie wyświetlamy ten filtr
            if (currentFilterId === filterId) {
                refreshItems();
            }

            // Odśwież liczniki filtrów
            updateFilterCounts();
        }
    }

    // ==================== TRANSLATIONS ====================

    const translationResults = { success: {}, failed: [] };

    // Klucze które nie są obsługiwane przez parser lub wymagają specjalnych wartości
    const EXCLUDED_PARSER_KEYS = new Set([
        // Specjalne klucze parsera
        'action', // ma warianty action=auction, action=deposit, etc.
        'cmp-header', // specjalny klucz dla porównywania
        'item_value', // wyliczane dynamicznie

        // Właściwości obiektu Item (nie statystyki w .stat)
        'cl', 'name', 'tpl', 'pr', 'wt', 'loc', 'enhancementPoints',
        'enhancement_upgrade_lvl', // wyświetlane jako gwiazdki

        // Statystyki wymagające specjalnych wartości/kontekstu
        'created', 'emo', 'quest', 'rkey', 'pet',

        // Statystyki które wymagają złożonych wartości
        'afterheal', 'afterheal2', 'btype', 'frost', 'poison', 'wound',
    ]);

    // Ręczne tłumaczenia dla kluczy które nie działają z parserem
    const MANUAL_TRANSLATIONS = {
        'cl': 'Klasa przedmiotu',
        'name': 'Nazwa przedmiotu',
        'rarity': 'Rzadkość',
        'tpl': 'Szablon graficzny',
        'pr': 'Cena',
        'wt': 'Waga',
        'loc': 'Lokalizacja',
        'enhancementPoints': 'Punkty ulepszenia',
        'enhancement_upgrade_lvl': 'Poziom ulepszenia',
    };

    // Funkcja do pobierania tłumaczeń klas przedmiotów ze słownika gry
    function getClTranslation(clValue) {
        if (typeof _t !== 'function') return null;
        const key = 'au_cat' + clValue;
        const translation = _t(key, null, 'auction');
        // Sprawdź czy to prawdziwe tłumaczenie (nie klucz)
        if (translation && !translation.startsWith('[T:') && translation !== key) {
            return translation;
        }
        return null;
    }

    function getTranslation(key) {
        try {
            // Sprawdź czy to klucz z ręcznym tłumaczeniem
            if (MANUAL_TRANSLATIONS[key]) {
                translationResults.success[key] = MANUAL_TRANSLATIONS[key];
                return MANUAL_TRANSLATIONS[key];
            }

            // Pomiń parser dla wykluczonych kluczy
            const skipParser = EXCLUDED_PARSER_KEYS.has(key) || key.startsWith('action=');

            // PRIORYTET 1: Użyj MargoTipsParser.statsParser.parseStat - uniwersalny parser dla WSZYSTKICH statystyk
            if (!skipParser && typeof MargoTipsParser !== 'undefined' && MargoTipsParser.statsParser && MargoTipsParser.statsParser.parseStat) {
                try {
                    // Wywołaj uniwersalny parser z minimalnym mockData
                    const result = MargoTipsParser.statsParser.parseStat({
                        actualStatName: key,
                        actualStatVal: '100',
                        eqStatClass: '',
                        cmpStr: '',
                        cmp: null,
                        itemData: { cl: 1, stat: key + '=100', loc: 'g', name: 'Item' },
                        allStats: { [key]: '100' },
                        missStats: null
                    });

                    // Wynik to obiekt z sectionIndex, actualStatName, statText, options
                    if (result && result.statText) {
                        // Wyciągnij czysty tekst z HTML
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = result.statText;
                        let cleaned = tempDiv.textContent || tempDiv.innerText || '';

                        // Usuń wartości liczbowe, zachowaj tekst
                        cleaned = cleaned
                            .replace(/[\+\-]?\d+[\.,]?\d*/g, '') // usuń liczby
                            .replace(/%/g, '')                    // usuń procenty
                            .replace(/\([^\)]*\)/g, '')          // usuń nawiasy z zawartością
                            .replace(/\s+/g, ' ')                 // normalizuj białe znaki
                            .trim();

                        // Sprawdź czy dostaliśmy sensowny wynik
                        if (cleaned && cleaned.length > 0 &&
                            !cleaned.startsWith('[T:') &&
                            !cleaned.startsWith('UNDEFINED') &&
                            cleaned !== key) {  // nie chcemy że zwraca samo nazwę klucza
                            translationResults.success[key] = cleaned;
                            return cleaned;
                        }
                    }
                } catch(parserError) {
                    // Parser nie zadziałał, użyj fallback
                    console.warn('[Sortownik] statsParser.parseStat failed for', key, ':', parserError.message);
                }
            }

            // FALLBACK: Bezpośrednie wywołania _t (stary sposób)
            if (typeof _t !== 'function') {
                translationResults.failed.push(key + ' (_t not available)');
                return null;
            }

            // action=wartość -> różne klucze w zależności od wartości
            if (key.startsWith('action=')) {
                const actionValue = key.split('=')[1];
                const actionKeys = {
                    'flee': 'flee_item_description',
                    'mail': 'mail_item_description',
                    'auction': 'auction_item_description',
                    'nloc': 'nloc_monster_item_description',
                    'deposit': 'call_depo',
                    'clandeposit': 'call_clandepo',
                    'shop': 'call_shop',
                    'fatigue': 'fatigue_positive %val%',
                    'fightperheal': 'fightperheal %amount%' // używa klucza fightperheal, nie action
                };
                const translationKey = actionKeys[actionValue];
                if (translationKey) {
                    const result = _t(translationKey, {'%val%': '', '%amount%': ''});
                    if (!result.startsWith('[T:') && !result.startsWith('bonus_') && !result.startsWith('item_') && !result.startsWith('no_percent_bonus_') && !result.startsWith('action=')) {
                        const cleaned = result.replace(/<br\s*\/?>/g, ' ').replace(/\s*%\w+%/g, '').replace(/\s+/g, ' ').trim();
                        translationResults.success[key] = cleaned;
                        return cleaned;
                    }
                }
                // Fallback dla nieznanych action
                translationResults.failed.push(key);
                return null;
            }

            // Dla innych pól - większość ma format 'bonus_key %val%' lub 'item_key %val%' w słowniku
            const variants = [
                'bonus_' + key + ' %val%',
                'item_' + key + ' %val%',
                'no_percent_bonus_' + key + ' %val%',
                key + ' %amount%',
                key + ' %val%',
                key,
                key + '_item_description'
            ];

            for (const variant of variants) {
                const result = _t(variant, {'%val%': '', '%amount%': ''});
                // Sprawdź czy to prawdziwe tłumaczenie (nie zaczyna się od [T:, bonus_, item_ ani no_percent_bonus_)
                if (!result.startsWith('[T:') && !result.startsWith('bonus_') && !result.startsWith('item_') && !result.startsWith('no_percent_bonus_')) {
                    const cleaned = result.replace(/<br\s*\/?>/g, ' ').replace(/\s*%\w+%/g, '').replace(/\s+/g, ' ').trim();
                    translationResults.success[key] = cleaned;
                    return cleaned;
                }
            }

            translationResults.failed.push(key);
            return null;
        } catch(e) {
            translationResults.failed.push(key + ' (ERROR: ' + e.message + ')');
            return null;
        }
    }

    function logTranslationResults() {
        console.log('[Sortownik] Translation Results:', {
            success: translationResults.success,
            failed: translationResults.failed,
            successCount: Object.keys(translationResults.success).length,
            failedCount: translationResults.failed.length
        });
    }

    // ==================== EXPRESSION PARSER ====================

    function parseItemStats(item) {
        // Jeśli już sparsowane, zwróć cache (optymalizacja - parsujemy tylko raz)
        if (item.parsedStats) {
            return item.parsedStats;
        }

        const s = {};

        // Parsuj stat string lub użyj obiektu jeśli już sparsowany
        if (item.stat) {
            if (typeof item.stat === 'string') {
                for (const pair of item.stat.split(';')) {
                    const eq = pair.indexOf('=');
                    if (eq > 0) s[pair.substring(0, eq)] = pair.substring(eq + 1);
                    else if (pair.trim()) s[pair.trim()] = '1';
                }
            } else {
                // Jeśli stat jest już obiektem (cache z gry)
                Object.assign(s, item.stat);
            }
        }

        // Bezpośrednie pola obiektu item
        const props = ['cl','name','enhancementPoints','tpl','id','loc','own','amount','pr','ttl','wt','icon','tip'];
        for (const p of props) {
            if (item[p] !== undefined && item[p] !== null) s[p] = String(item[p]);
        }

        // Rarity jako wygodny alias
        if (!s.rarity) {
            if (typeof item.stat === 'string') {
                const m = item.stat.match(/rarity=([^;]+)/);
                if (m) s.rarity = m[1]; else s.rarity = 'common';
            } else if (item.stat && item.stat.rarity) {
                s.rarity = item.stat.rarity;
            } else {
                s.rarity = 'common';
            }
        }

        // Zapisz w cache (na obiekcie item) dla szybszego dostępu następnym razem
        item.parsedStats = s;
        return s;
    }

    function getRarity(item) {
        if (!item) return 'common';
        if (item.itemTypeName) return item.itemTypeName;
        if (item.stat) {
            const m = item.stat.match(/rarity=([^;]+)/);
            if (m) return m[1];
            for (const r of ['heroic', 'upgraded', 'unique', 'legendary', 'artefact']) {
                if (new RegExp(`(?:^|;)${r}(?:;|$)`).test(item.stat)) return r;
            }
        }
        return 'common';
    }

    function evalCond(cond, stats) {
        const neg = cond.startsWith('!');
        const c   = neg ? cond.substring(1).trim() : cond.trim();
        if (!c) return true;

        let result;
        const op = c.match(/^([^=~><]+)([=~><])(.+)$/);
        if (op) {
            const key = op[1].trim(), val = stats[key];
            let arg = op[3].trim();

            switch (op[2]) {
                case '=':
                    result = val !== undefined && val.toLowerCase() === arg.toLowerCase();
                    break;
                case '~':
                    // Obsługa składni ~[wartość1,wartość2,...]
                    if (arg.startsWith('[') && arg.endsWith(']')) {
                        // Wyciągnij wartości z nawiasów i podziel po przecinkach
                        const values = arg.slice(1, -1).split(',').map(v => v.trim().toLowerCase());
                        // Sprawdź czy val zawiera którąkolwiek z wartości
                        result = val !== undefined && values.some(v => val.toLowerCase().includes(v));
                    } else {
                        // Normalna składnia ~
                        result = val !== undefined && val.toLowerCase().includes(arg.toLowerCase());
                    }
                    break;
                case '>':
                    result = val !== undefined && parseFloat(val) > parseFloat(arg);
                    break;
                case '<':
                    result = val !== undefined && parseFloat(val) < parseFloat(arg);
                    break;
                default:
                    result = false;
            }
        } else {
            const val = stats[c];
            result = val !== undefined && val !== '' && val !== '0';
        }
        return neg ? !result : result;
    }

    function evalExpr(expr, item) {
        if (!expr || !expr.trim()) return true;
        const stats = parseItemStats(item);

        // Funkcja pomocnicza do przetwarzania wyrażenia z nawiasami
        function processExpression(expression) {
            expression = expression.trim();

            // Rekurencyjnie przetwórz nawiasy od wewnątrz
            while (expression.includes('(')) {
                // Znajdź najbardziej zagnieżdżony nawias
                const lastOpen = expression.lastIndexOf('(');
                const nextClose = expression.indexOf(')', lastOpen);

                if (nextClose === -1) {
                    // Błąd składni - brakujący nawias zamykający
                    throw new Error('Brak nawiasu zamykającego');
                }

                // Wyciągnij zawartość nawiasu
                const inside = expression.substring(lastOpen + 1, nextClose);

                // Przetwórz zawartość nawiasu
                const result = evaluateSimple(inside);

                // Zamień nawias na wynik (true/false) jako specjalny token
                // Użyj unikalnego tokena który nie koliduje z nazwami statystyk
                const token = `__RESULT_${result}__`;
                expression = expression.substring(0, lastOpen) + token + expression.substring(nextClose + 1);
            }

            // Po przetworzeniu wszystkich nawiasów, oceń wyrażenie
            return evaluateSimple(expression);
        }

        // Funkcja do oceny prostego wyrażenia (bez nawiasów)
        function evaluateSimple(expression) {
            expression = expression.trim();

            // Obsłuż specjalne tokeny wyników z nawiasów
            if (expression.startsWith('__RESULT_')) {
                return expression === '__RESULT_true__';
            }

            // Split po | (OR) - najniższy priorytet
            const orGroups = expression.split('|');

            for (const orGroup of orGroups) {
                // Split po & (AND) - wyższy priorytet
                const andConditions = orGroup.split('&').map(c => c.trim()).filter(Boolean);

                // Sprawdź czy wszystkie warunki AND są spełnione
                const allAndTrue = andConditions.every(condition => {
                    // Obsłuż tokeny wyników
                    if (condition.startsWith('__RESULT_')) {
                        return condition === '__RESULT_true__';
                    }
                    // Oceń normalny warunek
                    return evalCond(condition, stats);
                });

                // Jeśli którykolwiek warunek OR jest spełniony, zwróć true
                if (allAndTrue) {
                    return true;
                }
            }

            return false;
        }

        try {
            return processExpression(expr);
        } catch(e) {
            // W przypadku błędu składni, zwróć false
            console.error('[Sortownik] Expression parse error:', e.message);
            return false;
        }
    }

    function matchesFilter(filter, item) {
        if (!filter || !item) return false;

        // Kategoria "Wszystko" (id === 0) pokazuje wszystko
        if (filter.id === 0) {
            return true;
        }

        // 1. Sprawdź wykluczenia (exclusions) - mają najwyższy priorytet
        if (filter.excludedIds && filter.excludedIds.length > 0) {
            const isExcludedById = filter.excludedIds.some(entry => {
                const eid = typeof entry === 'object' && entry !== null ? entry.id : entry;
                return String(eid) === String(item.id);
            });
            if (isExcludedById) return false;
        }

        if (filter.excludedNames && filter.excludedNames.length > 0) {
            const isExcludedByName = filter.excludedNames.some(name => name.toLowerCase() === item.name.toLowerCase());
            if (isExcludedByName) return false;
        }

        // 2. Sprawdź itemIds (dopasowanie po ID)
        const hasItemIds = filter.itemIds && filter.itemIds.length > 0;
        const matchesItemIds = hasItemIds ? filter.itemIds.some(entry => {
            const entryId = typeof entry === 'object' && entry !== null ? entry.id : entry;
            return String(entryId) === String(item.id);
        }) : false;

        if (matchesItemIds) {
            return true;
        }

        // 3. Sprawdź itemNames (case-insensitive dopasowanie po nazwie)
        const hasItemNames = filter.itemNames && filter.itemNames.length > 0;
        const matchesItemNames = hasItemNames ? filter.itemNames.some(name => name.toLowerCase() === item.name.toLowerCase()) : false;

        if (matchesItemNames) {
            return true;
        }

        // 4. Jeśli nie pasowało po ID ani nazwie, a wyrażenie jest puste, nic nie pasuje
        if (!filter.expression || !filter.expression.trim()) {
            return false;
        }

        // 5. Sprawdzamy wyrażenie
        return evalExpr(filter.expression, item);
    }

    // ==================== STATS SCANNER ====================

    function scanStats() {
        const map = new Map();

        // PRIORYTET 1: Użyj MargoTipsParser.configSections jeśli dostępny
        if (typeof MargoTipsParser !== 'undefined' && MargoTipsParser.configSections) {
            try {
                // Zbierz wszystkie statystyki z configSections
                for (const sectionId in MargoTipsParser.configSections) {
                    const stats = MargoTipsParser.configSections[sectionId];
                    for (const statName of stats) {
                        // Pomiń wykluczone klucze
                        if (EXCLUDED_PARSER_KEYS.has(statName)) {
                            continue;
                        }

                        if (!map.has(statName)) {
                            map.set(statName, new Set(['1'])); // Dodaj przykładową wartość
                        }
                    }
                }

                // Ręcznie dodaj warianty action
                const actionVariants = [
                    'action=auction',
                    'action=clandeposit',
                    'action=deposit',
                    'action=fatigue',
                    'action=fightperheal',
                    'action=flee',
                    'action=mail',
                    'action=nloc',
                    'action=shop'
                ];
                for (const variant of actionVariants) {
                    if (!map.has(variant)) {
                        map.set(variant, new Set(['1']));
                    }
                }

                // Dodaj podstawowe pola przedmiotu
                for (const p of ['cl','enhancementPoints','rarity','tpl','pr','ttl','wt','name','loc']) {
                    if (!map.has(p)) {
                        map.set(p, new Set(['1']));
                    }
                }

                console.log('[Sortownik] Loaded', map.size, 'stats from MargoTipsParser.configSections');
            } catch(e) {
                console.error('[Sortownik] Error loading from configSections:', e);
            }
        }

        // FALLBACK: Skanuj przedmioty w grze (jeśli parser nie zadziałał lub chcemy rzeczywiste wartości)
        try {
            for (const item of Engine.items.fetchLocationItems('g')) {
                if (item.stat) {
                    for (const pair of item.stat.split(';')) {
                        const eq = pair.indexOf('=');
                        if (eq > 0) {
                            const k = pair.substring(0, eq);
                            if (!map.has(k)) map.set(k, new Set());
                            map.get(k).add(pair.substring(eq + 1));
                        } else if (pair.trim()) {
                            // Flagi bez wartości (np. soulbound, legendary)
                            const k = pair.trim();
                            if (!map.has(k)) map.set(k, new Set());
                            map.get(k).add('1');
                        }
                    }
                }
                // Dodaj bezpośrednie właściwości
                for (const p of ['cl','enhancementPoints','rarity','tpl','pr','ttl','wt','name']) {
                    const v = p === 'rarity' ? getRarity(item) : item[p];
                    if (v !== undefined && v !== null) {
                        if (!map.has(p)) map.set(p, new Set());
                        map.get(p).add(String(v));
                    }
                }
            }
        } catch(e) {
            console.warn('[Sortownik] Could not scan items from inventory:', e);
        }

        return map;
    }

    // ==================== ITEM RENDERING ====================

    // Auto-scroll listy itemów podczas przeciągania
    let autoScrollInterval = null;
    let autoScrollSpeed = 0;
    const AUTO_SCROLL_ZONE = 40;      // piksel od krawędzi gdzie zaczyna się scroll
    const AUTO_SCROLL_MAX_SPEED = 15; // maksymalna prędkość scrollowania

    function startItemListAutoScroll() {
        if (autoScrollInterval) return;

        autoScrollInterval = setInterval(() => {
            if (autoScrollSpeed !== 0 && panelEl) {
                // Znajdź scroll-pane wewnątrz sort-scroll-wrapper (dla listy itemów)
                const scrollWrapper = panelEl.querySelector('.sort-scroll-wrapper');
                const pane = scrollWrapper ? scrollWrapper.querySelector('.scroll-pane') : null;

                if (pane) {
                    pane.scrollTop += autoScrollSpeed;
                    if (scrollWrapper && scrollWrapper._updateScrollBar) {
                        scrollWrapper._updateScrollBar();
                    }
                }
            }
        }, 16); // ~60fps
    }

    function updateItemListAutoScroll(e) {
        if (!panelEl) {
            autoScrollSpeed = 0;
            return;
        }

        // Znajdź scroll-pane wewnątrz sort-scroll-wrapper (dla listy itemów)
        const scrollWrapper = panelEl.querySelector('.sort-scroll-wrapper');
        const pane = scrollWrapper ? scrollWrapper.querySelector('.scroll-pane') : null;

        if (!pane) {
            autoScrollSpeed = 0;
            return;
        }

        const rect = pane.getBoundingClientRect();
        const mouseY = e.clientY || (e.originalEvent && e.originalEvent.clientY) || 0;

        // Sprawdź czy mysz jest w obszarze listy itemów
        if (mouseY < rect.top || mouseY > rect.bottom) {
            autoScrollSpeed = 0;
            return;
        }

        // Oblicz odległość od górnej i dolnej krawędzi
        const distanceFromTop = mouseY - rect.top;
        const distanceFromBottom = rect.bottom - mouseY;

        // Scrolluj w górę gdy jesteśmy blisko górnej krawędzi
        if (distanceFromTop < AUTO_SCROLL_ZONE && pane.scrollTop > 0) {
            // Im bliżej krawędzi, tym szybciej scrollujemy
            const ratio = 1 - (distanceFromTop / AUTO_SCROLL_ZONE);
            autoScrollSpeed = -Math.ceil(ratio * AUTO_SCROLL_MAX_SPEED);
        }
        // Scrolluj w dół gdy jesteśmy blisko dolnej krawędzi
        else if (distanceFromBottom < AUTO_SCROLL_ZONE &&
                 pane.scrollTop < pane.scrollHeight - pane.clientHeight) {
            const ratio = 1 - (distanceFromBottom / AUTO_SCROLL_ZONE);
            autoScrollSpeed = Math.ceil(ratio * AUTO_SCROLL_MAX_SPEED);
        }
        // Zatrzymaj scrollowanie gdy nie jesteśmy w strefie
        else {
            autoScrollSpeed = 0;
        }
    }

    function stopItemListAutoScroll() {
        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }
        autoScrollSpeed = 0;
    }

    function showSplitDialog(item, targetX, targetY) {
        try {
            const amount = parseInt(item.getAmountStat());
            const maxAmount = amount - 1;

            // Użyj funkcji mAlert z gry do pokazania okna
            const message = _t('item_split %max%', {'%max%': maxAmount}, 'item');
            const inputHtml = '<div class="input-wrapper"><input id="divide-items" class="default" placeholder="..." /></div>';

            mAlert(message + inputHtml, [{
                txt: 'Ok',
                callback: function() {
                    const $input = $('#divide-items');
                    if (!$input.length) return true;

                    let value = $input.val().trim();
                    // Usuń spacje i przetworzyć wartość (obsługa k/m/g jak w grze)
                    value = value.replace(/\s/g, '');

                    // Parsuj wartość z k/m/g
                    let numValue = parseFloat(value);
                    if (value.toLowerCase().includes('k')) numValue *= 1000;
                    else if (value.toLowerCase().includes('m')) numValue *= 1000000;
                    else if (value.toLowerCase().includes('g')) numValue *= 1000000000;
                    numValue = Math.floor(numValue);

                    // Walidacja
                    if (isNaN(numValue) || numValue < 1 || numValue >= amount) {
                        mAlert(_t('split_bad_value', null, 'item'));
                        return false;
                    }

                    // Wyślij request do gry
                    _g('moveitem&findslot=1&st=0&id=' + item.id + '&x=' + targetX + '&y=' + targetY + '&split=' + numValue);
                    return true;
                }
            }, {
                txt: _t('cancel', null, 'buttons'),
                callback: function() {
                    return true;
                }
            }], function(w) {
                // Callback po utworzeniu okna
                const $input = w.$.find('.default');
                w.$.addClass('askAlert');

                // Ustaw maskę inputu (tylko liczby z k/m/g)
                if (typeof setInputMask === 'function' && typeof InputMaskData !== 'undefined') {
                    setInputMask($input, InputMaskData.TYPE.NUMBER_WITH_KMG);
                }

                // Autofocus na desktop
                if (typeof mobileCheck === 'function' && !mobileCheck()) {
                    setTimeout(() => $input.focus(), 100);
                }
            });
        } catch(e) {
            console.error('[Sortownik] Error showing split dialog:', e);
        }
    }

    function getFreeSlotsInMainBags() {
        let free = 0;
        try {
            // Główne torby to indeksy 0, 1, 2
            [0, 1, 2].forEach(index => {
                const bag = Engine.bags[index];
                if (!bag) return;
                // bag[0] = capacity, bag[1] = used slots
                const available = bag[0] - bag[1];
                free += available < 0 ? 0 : available;
            });
        } catch(e) {}
        return free;
    }

    function updateBagSlotsDisplay() {
        const slotsEl = document.getElementById('sort-bag-slots');
        if (!slotsEl) return;
        const freeSlots = getFreeSlotsInMainBags();
        slotsEl.textContent = freeSlots + 'm';

        // Dodaj klasę i tooltip gdy mało miejsca
        if (freeSlots <= 6) {
            slotsEl.classList.add('sort-bag-low');
        } else {
            slotsEl.classList.remove('sort-bag-low');
        }

        // Ustaw tooltip
        addTip(slotsEl, 'Wolne miejsca w głównych torbach');
    }

    function updateItemAmount(amountEl, item) {
        // Aktualizuj wyświetlaną ilość przedmiotów
        if (item.issetAmountStat && item.issetAmountStat()) {
            const amount = parseInt(item.getAmountStat());
            // Użyj funkcji z gry do formatowania dużych liczb (k/m/g)
            const formattedAmount = typeof roundShorten === 'function' ? roundShorten(amount) : amount.toString();
            amountEl.textContent = formattedAmount;
            amountEl.style.display = 'block';
        } else {
            amountEl.textContent = '';
            amountEl.style.display = 'none';
        }
    }

    function createItemSlot(item) {
        const slot = document.createElement('div');
        slot.className = 'sort-item-slot';
        slot._slotId = String(item.id);

        try {
            // Użyj createViewIcon z gry — automatycznie tworzy ikonę z ramką i canvasem
            const viewName = Engine.itemsViewData.INVENTORY_BROWSER_VIEW;
            const $iconArray = Engine.items.createViewIcon(item.id, viewName);
            if (!$iconArray || !$iconArray[0]) throw new Error('createViewIcon failed');

            const $icon = $iconArray[0];  // jQuery object
            const iconEl = $icon[0];      // DOM element

            if (!iconEl) throw new Error('iconEl is null');

            // createViewIcon może ustawić własne style, upewniamy się że jest widoczny
            iconEl.style.position = 'relative';
            iconEl.style.display = 'block';

            slot.appendChild(iconEl);

            // Aktualizuj licznik ilości przedmiotów
            // createViewIcon może już dodać element .amount, więc go znajdziemy i zaktualizujemy
            // Jeśli nie istnieje, utworzymy własny
            setTimeout(() => {
                let amountEl = iconEl.querySelector('.amount');
                if (!amountEl) {
                    amountEl = document.createElement('div');
                    amountEl.className = 'amount';
                    iconEl.appendChild(amountEl);
                }
                updateItemAmount(amountEl, item);

                // Sprawdź i dodaj klasy disable jeśli przedmiot powinien być zablokowany
                if (typeof Engine !== 'undefined' && Engine.disableItemsManager && Engine.disableItemsManager.manageItemDisableInHeroEQ) {
                    Engine.disableItemsManager.manageItemDisableInHeroEQ(item, $icon);
                }
            }, 0);

            // Dodaj możliwość przeciągania - użyj tych samych opcji co gra
            $icon.pointerDraggable({
                appendTo: 'body',
                helper: 'clone',
                distance: 24,
                cursorAt: { top: 16, left: 16 },
                scroll: false,
                zIndex: 20,
                start: function(e, ui) {
                    try {
                        // Sprawdź czy trzymany jest Shift (dla dzielenia)
                        if (e.shiftKey && item.issetAmountStat && item.issetAmountStat()) {
                            const amount = parseInt(item.getAmountStat());
                            if (amount > 1) {
                                // Oznacz że to dzielenie
                                ui.helper.data('splitting', true);
                            }
                        }

                        // Użyj funkcji z gry do zmiany wyglądu helpera
                        if (typeof changeViewOfHelper === 'function') {
                            changeViewOfHelper(ui.helper, item.id);
                        }
                        if (typeof startDraggingEvent === 'function') {
                            startDraggingEvent($icon);
                        }

                        // Uruchom auto-scroll dla listy itemów
                        startItemListAutoScroll();
                    } catch(ex) {}
                },
                drag: function(e, ui) {
                    try {
                        // Aktualizuj auto-scroll podczas przeciągania
                        updateItemListAutoScroll(e);
                    } catch(ex) {}
                },
                stop: function(e, ui) {
                    try {
                        if (typeof stopDraggingEvent === 'function') {
                            stopDraggingEvent($icon);
                        }

                        // Zatrzymaj auto-scroll
                        stopItemListAutoScroll();
                    } catch(ex) {}
                }
            });

            // Klik — użyj / załóż (przekaż jQuery object)
            iconEl.addEventListener('click', () => {
                try {
                    // Sprawdź czy aktywne jest okno depo/shop/enhancement
                    const isSpecialWindowActive = typeof Engine !== 'undefined' &&
                        Engine.disableItemsManager &&
                        Engine.disableItemsManager.activeDisableKinds &&
                        Object.keys(Engine.disableItemsManager.activeDisableKinds).some(
                            key => Engine.disableItemsManager.activeDisableKinds[key] === true
                        );

                    // Pojedyncze kliknięcie działa gdy:
                    // 1. Tryb to 'single' LUB
                    // 2. Aktywne jest okno depo/shop/enhancement
                    if (settings.itemClickMode === 'single' || isSpecialWindowActive) {
                        // Tryb pojedynczego kliknięcia
                        if (!Engine.heroEquipment.afterOneClick(item, $icon)) {
                            Engine.heroEquipment.afterDoubleClick(item, $icon);
                        }
                    }
                    // W trybie double-click (bez aktywnego okna) nic nie robimy przy pojedynczym kliknięciu
                } catch(e) {}
            });

          // Dodaj droppable aby umożliwić upuszczanie przedmiotów na przedmioty (stackowanie i dzielenie)
            $icon.pointerDroppable({
                accept: '.item:not(.shop-item)',
                drop: function(e, ui) {
                    try {
                        const draggedItem = ui.draggable.data('item');
                        const targetItem = item;

                        // Jeśli to ten sam przedmiot, zignoruj
                        if (!draggedItem || draggedItem.id === targetItem.id) return;

                        // Sprawdź czy to dzielenie (Shift był trzymany)
                        const isSplitting = ui.helper.data('splitting');

                        if (isSplitting) {
                            // Dzielenie przedmiotu
                            if (draggedItem.issetAmountStat && draggedItem.issetAmountStat()) {
                                const amount = parseInt(draggedItem.getAmountStat());
                                if (amount > 1) {
                                    // Sprawdź czy można dzielić
                                    if (parseInt(draggedItem.getCansplitStat && draggedItem.getCansplitStat()) === 0) {
                                        mAlert(_t('this_item_cant_split', null, 'item'));
                                        return;
                                    }

                                    // Sprawdź czy ma capacity lub jest strzałą
                                    const canSplit = draggedItem.getCapacityStat && draggedItem.getCapacityStat() ||
                                                   (typeof ItemClass !== 'undefined' && ItemClass.isArrowsCl && ItemClass.isArrowsCl(draggedItem.cl));

                                    if (!canSplit) {
                                        mAlert(_t('this_item_cant_split', null, 'item'));
                                        return;
                                    }

                                    // Pokaż okno z pytaniem o ilość
                                    showSplitDialog(draggedItem, targetItem.x, targetItem.y);
                                    e.stopPropagation();
                                    return;
                                }
                            }
                        } else {
                            // Stackowanie - sprawdź czy przedmioty mogą być połączone (ten sam tpl)
                            if (draggedItem.tpl === targetItem.tpl) {
                                // Wyślij request do gry aby połączyć przedmioty
                                // Umieść przeciągany przedmiot na pozycji docelowego
                                _g('moveitem&st=0&id=' + draggedItem.id + '&x=' + targetItem.x + '&y=' + targetItem.y);
                                e.stopPropagation();
                                return;
                            }
                        }

                        // Jeśli nie można połączyć/podzielić, pozwól grze obsłużyć to normalnie
                        // (np. wyświetli menu co zrobić z przedmiotem)
                    } catch(ex) {
                        console.error('[Sortownik] Drop error:', ex);
                    }
                }
            });

            // Podwójne kliknięcie — zawsze aktywne
            iconEl.addEventListener('dblclick', () => {
                try {
                    if (!Engine.heroEquipment.afterOneClick(item, $icon)) {
                        Engine.heroEquipment.afterDoubleClick(item, $icon);
                    }
                } catch(e) {}
            });

            // Prawy klik — menu kontekstowe gry
            iconEl.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                try { item.createOptionMenu(e, false); } catch(ex) {}
            });

        } catch(e) {
            // Fallback — jeśli createViewIcon nie działa, użyj prostego placeholder
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'width:32px;height:32px;background:#333;border:1px solid #555;display:flex;align-items:center;justify-content:center;color:#999;';
            placeholder.textContent = '?';
            placeholder.title = `Error: ${e.message}`;
            slot.appendChild(placeholder);
        }

        return slot;
    }

    // ==================== CSS STYLES ====================

    function createStyles() {
        const css = `
/* ===== SORTOWNIK ===== */
#sortownik-toggle {
    position: fixed;
    left: 10px;
    top: 100px;
    width: 40px;
    height: 40px;
    background: rgba(30,30,30,0.9);
    border: 1px solid rgba(100,100,100,0.5);
    border-radius: 4px;
    cursor: pointer;
    z-index: 10;
    user-select: none;
    transition: border-color .15s;
}
#sortownik-toggle:hover {
    border-color: rgba(120,180,255,0.6);
}
#sortownik-toggle.sort-active {
    border-color: rgba(120,180,255,0.9);
    box-shadow: 0 0 10px rgba(120,180,255,0.3);
}

/* Panel */
#sortownik-panel {
    position: fixed;
    background: rgba(14,14,14,0.93);
    border: 1px solid rgba(80,80,80,0.45);
    border-radius: 4px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.55);
    width: 282px; /* 32px filtry + 250px reszta */
    max-height: 400px;
    padding-bottom: 3px;
    z-index: 10;
    font-size: 12px;
    color: #ddd;
    display: none;
    flex-direction: column;
}
#sortownik-panel.sort-show { display: flex; }

/* Resize handle */
.sort-resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    z-index: 100;
}
.sort-resize-handle::before {
    content: '';
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 0 0 10px 10px;
    border-color: transparent transparent rgba(255,255,255,0.3) transparent;
}
.sort-resize-handle:hover::before {
    border-color: transparent transparent rgba(255,255,255,0.5) transparent;
}

/* Główny kontener - adaptuje się do layoutu */
.sort-main-content {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.sort-main-content.sort-layout-horizontal {
    flex-direction: row;
}
.sort-main-content.sort-layout-vertical {
    flex-direction: column;
}

/* Title bar */
.sort-titlebar {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 4px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    user-select: none;
    flex-shrink: 0;
    position: relative;
}
.sort-titlebar:active { cursor: grabbing; }
.sort-titlebar.locked { cursor: url("/img/gui/cursor/1n.png?v=9ba6b5fe1722a"), url("/img/gui/cursor/1n.cur?v=9ba6b5fe1722a"), auto !important; }
.sort-titlebar.locked:active { cursor: url("/img/gui/cursor/1n.png?v=9ba6b5fe1722a"), url("/img/gui/cursor/1n.cur?v=9ba6b5fe1722a"), auto !important; }
.sort-title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    font-size: 11px;
    color: #bbb;
    letter-spacing: 0.5px;
    pointer-events: none;
}
.sort-tb-btn {
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: #888; font-size: 14px; border-radius: 2px;
    transition: color .12s, background .12s;
}
.sort-tb-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
#sort-toggle-filters-btn svg {
    width: 14px;
    height: 14px;
    fill: #888;
    transition: fill .12s;
    margin-top: 1px;
}
#sort-toggle-filters-btn:hover svg {
    fill: #fff;
}
#sort-lock-btn svg {
    width: 14px;
    height: 14px;
}
#sort-opacity-btn svg {
    width: 14px;
    height: 14px;
}

/* Filters column (lewa/prawa strona) */
.sort-filters-column {
    display: flex;
    flex-direction: column;
    width: 32px; /* Dokładnie szerokość ikon, bez paddingu */
    flex-shrink: 0;
    background: rgba(0,0,0,0.2);
}
.sort-filters-column.sort-filters-column-wide {
    width: 67px; /* 2 ikony po 32px + gap 3px */
}
/* 75% scale */
.sort-filters-column.sort-filters-column-medium {
    width: 24px;
}
.sort-filters-column.sort-filters-column-medium.sort-filters-column-wide {
    width: 51px; /* 2 ikony po 24px + gap 3px */
}
/* 50% scale */
.sort-filters-column.sort-filters-column-small {
    width: 16px;
}
.sort-filters-column.sort-filters-column-small.sort-filters-column-wide {
    width: 35px; /* 2 ikony po 16px + gap 3px */
}
.sort-filters-left {
    border-right: 1px solid rgba(255,255,255,0.08);
}
.sort-filters-right {
    border-left: 1px solid rgba(255,255,255,0.08);
}

.sort-custom-scroll-container.sort-filters-wrapper {
    flex: 1;
    min-height: 0;
    position: relative;
}

.sort-custom-scroll-container.sort-filters-wrapper .scroll-pane {
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    width: 100%;
}

/* Filters row - teraz pionowo */
.sort-filters {
    display: flex;
    flex-direction: column; /* Domyślnie pionowo dla left/right */
    padding: 3px 0px;
    flex-shrink: 0;
    min-height: min-content;
    width: 100%;
    align-items: flex-start; /* Przyklej do lewej (góry w pionie) zamiast wyśrodkować */
    gap: 1px; /* Mały gap jak w Margonem */
}
/* Dla top/bottom: domyślnie poziomo w jednej linii */
.sort-filters.sort-filters-horizontal {
    flex-direction: row;
    padding: 3px 4px;
    min-width: min-content;
    width: auto;
    height: 32px;
    justify-content: flex-start; /* Przyklej do lewej zamiast wyśrodkować */
}
/* 75% scale dla top/bottom */
.sort-filters.sort-filters-horizontal.sort-filters-medium {
    height: 24px;
}
/* 50% scale dla top/bottom */
.sort-filters.sort-filters-horizontal.sort-filters-small {
    height: 16px;
}
/* Gdy włączone zawijanie (2 wiersze) */
.sort-filters.sort-filters-wrap {
    flex-direction: row;
    flex-wrap: wrap;
    align-content: flex-start;
    overflow: visible;
    height: auto; /* Pozwól na rozszerzenie wysokości */
    min-height: 32px;
}
.sort-filters.sort-filters-wrap.sort-filters-medium {
    min-height: 24px;
}
.sort-filters.sort-filters-wrap.sort-filters-small {
    min-height: 16px;
}
/* Dla top/bottom z zawijaniem: zachowaj ten sam padding i height: auto */
.sort-filters.sort-filters-horizontal.sort-filters-wrap {
    padding: 3px 4px; /* Taki sam padding jak w jednej linii */
    height: auto !important; /* Nadpisz sztywną wysokość z .sort-filters-horizontal */
}
/* Domyślna wysokość dla top/bottom wrapperów (1 wiersz, 100% scale) */
.sort-filters-top-wrapper,
.sort-filters-bottom-wrapper {
    height: 37px !important; /* 32+3+2 na border */
}
/* Dla top/bottom z zawijaniem: zwiększ wysokość wrappera (100% scale) */
.sort-filters-top-wrapper.sort-wrapper-tall,
.sort-filters-bottom-wrapper.sort-wrapper-tall {
    height: 71px !important; /* 2 rzędy: 32+3+32+4 */
}
/* 75% scale dla normalnego wrappera (1 wiersz) */
.sort-filters-top-wrapper.sort-wrapper-medium,
.sort-filters-bottom-wrapper.sort-wrapper-medium {
    height: 28px !important; /* 24+3+1 dodatkowy padding */
}
/* 50% scale dla normalnego wrappera (1 wiersz) */
.sort-filters-top-wrapper.sort-wrapper-small,
.sort-filters-bottom-wrapper.sort-wrapper-small {
    height: 20px !important; /* 16+3+1 dodatkowy padding */
}
/* 75% scale dla wrappera z 2 wierszami - MUSI BYĆ PO regułach dla 1 wiersza! */
.sort-filters-top-wrapper.sort-wrapper-tall.sort-wrapper-medium,
.sort-filters-bottom-wrapper.sort-wrapper-tall.sort-wrapper-medium {
    height: 55px !important; /* 2 rzędy: 24+3+24+3+1 dodatkowy padding */
}
/* 50% scale dla wrappera z 2 wierszami - MUSI BYĆ PO regułach dla 1 wiersza! */
.sort-filters-top-wrapper.sort-wrapper-tall.sort-wrapper-small,
.sort-filters-bottom-wrapper.sort-wrapper-tall.sort-wrapper-small {
    height: 39px !important; /* 2 rzędy: 16+3+16+3+1 dodatkowy padding */
}
.sort-filters::-webkit-scrollbar { height: 5px; width: 5px; }
.sort-filters::-webkit-scrollbar-track { background: transparent; }
.sort-filters::-webkit-scrollbar-thumb {
    background: #d1d2d385;
    border-radius: 14px;
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto;
}
.sort-filters::-webkit-scrollbar-thumb:hover { background: #d1d2d3b0; }

.sort-filter-tab {
    position: relative;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.55;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity .12s, background .12s;
}
.sort-filter-tab.active { opacity: 1; }
.sort-filter-tab:hover  { background: rgba(255,255,255,0.12); }

/* Skalowanie 75% */
.sort-filter-tab.sort-filter-medium {
    width: 24px;
    height: 24px;
}
/* Skalowanie 50% */
.sort-filter-tab.sort-filter-small {
    width: 16px;
    height: 16px;
}

.sort-filter-icon {
    width: 32px; height: 32px;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    image-rendering: auto;
}
/* Skalowanie 75% dla ikony */
.sort-filter-tab.sort-filter-medium .sort-filter-icon {
    width: 24px;
    height: 24px;
}
/* Skalowanie 50% dla ikony */
.sort-filter-tab.sort-filter-small .sort-filter-icon {
    width: 16px;
    height: 16px;
}
.sort-filter-icon.sort-icon-all {
    background: url("https://micc.garmory-cdn.cloud/obrazki/itemy/bag/torba12.gif") no-repeat;
    width: 32px; height: 32px;
}
.sort-filter-tab.sort-filter-medium .sort-filter-icon.sort-icon-all {
    width: 24px;
    height: 24px;
    background-size: 24px 24px;
}
.sort-filter-tab.sort-filter-small .sort-filter-icon.sort-icon-all {
    width: 16px;
    height: 16px;
    background-size: 16px 16px;
}
.sort-filter-icon.sort-icon-add {
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    width: 32px;
    height: 32px;
}
.sort-filter-tab.sort-filter-medium .sort-filter-icon.sort-icon-add {
    font-size: 14px;
    width: 24px;
    height: 24px;
}
.sort-filter-tab.sort-filter-small .sort-filter-icon.sort-icon-add {
    font-size: 12px;
    width: 16px;
    height: 16px;
}

.sort-filter-tab .sort-amount {
    pointer-events: none;
    position: absolute;
    background: rgba(0,0,0,0.55);
    font-size: 9px;
    line-height: 10px;
    padding: 0 2px;
    bottom: 0; right: 0;
    border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.4);
    color: #fff;
    white-space: nowrap;
}
/* Skalowanie 75% dla licznika */
.sort-filter-tab.sort-filter-medium .sort-amount {
    font-size: 8px;
    line-height: 9px;
    padding: 0 1px;
    bottom: -1px;
    right: -1px;
}
/* Skalowanie 50% dla licznika */
.sort-filter-tab.sort-filter-small .sort-amount {
    font-size: 7px;
    line-height: 8px;
    padding: 0 1px;
    bottom: -1px;
    right: -1px;
}
.sort-filter-tab .sort-amount:empty { display: none; }

/* Prawa strona (search + lista itemów) */
.sort-right-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

/* Search */
.sort-search-wrap {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
    height: 20px;
}
.sort-search-wrap .sort-search-icon {
    color: #666;
    font-size: 13px;
    margin-right: 5px;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.sort-search-icon svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: #666;
    stroke-width: 2;
    stroke-linecap: round;
}
.sort-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #ccc;
    font-size: 11px;
    font-family: inherit;
    min-width: 0;
}
.sort-search-input::placeholder { color: #555; }
.sort-bag-slots {
    color: #888;
    font-size: 11px;
    white-space: nowrap;
    margin-left: 4px;
    flex-shrink: 0;
    transition: color .2s;
}
.sort-bag-slots.sort-bag-low {
    color: #ff4444;
}

/* Margonem-style overlay scrollbar wrapper */
.sort-scroll-wrapper,
.sort-custom-scroll-container {
    position: relative;
}
.sort-scroll-wrapper {
    flex: 1 1 0;
    min-height: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
}
.sort-scroll-wrapper.scrollable > .scrollbar-wrapper,
.sort-custom-scroll-container.scrollable > .scrollbar-wrapper,
.scrollbar-wrapper.scrollable {
    display: block !important;
}
.sort-scroll-wrapper > .scrollbar-wrapper,
.sort-custom-scroll-container > .scrollbar-wrapper,
.scrollbar-wrapper {
    display: none;
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 8px;
    z-index: 20;
    pointer-events: none;
}
.scrollbar-wrapper .track {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 1px;
    width: 7px;
    pointer-events: auto;
}
.scrollbar-wrapper .track .handle {
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto !important;
    background: #d1d2d385;
    border-radius: 14px;
    width: 5px;
    height: 44px;
    position: absolute;
    top: 0;
    pointer-events: auto;
}
.scrollbar-wrapper .track .handle:active {
    cursor: grabbing !important;
}

/* Horizontal Margonem scrollbar */
.scrollbar-wrapper--horizontal {
    display: none;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 5px;
    top: auto !important;
    width: 100% !important;
    z-index: 20;
    pointer-events: none;
}
.scrollbar-wrapper--horizontal.scrollable,
.sort-custom-scroll-container.scrollable > .scrollbar-wrapper--horizontal {
    display: block !important;
}
.scrollbar-wrapper--horizontal .track {
    position: absolute;
    left: 1px;
    right: 1px;
    bottom: 0;
    top: auto;
    width: auto !important;
    height: 5px;
    pointer-events: auto;
}
.scrollbar-wrapper--horizontal .track .handle {
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto !important;
    background: #d1d2d385;
    border-radius: 14px;
    height: 4px;
    width: 36px;
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: auto;
}
.scrollbar-wrapper--horizontal .track .handle:active {
    cursor: grabbing !important;
}

/* Scroll-pane strictly fills wrapper */
.sort-scroll-wrapper .scroll-pane {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
}

/* Item list (content inside scroll-pane) */
.sort-item-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, 32px);
    justify-content: start; /* Przyklej do lewej strony zamiast wyśrodkować */
    align-content: flex-start;
    gap: 1px; /* Mały gap jak w Margonem */
    padding: 0px 3px 0px 3px; /* Zmniejszony padding dla lepszego dopasowania grid */
    margin-top: 3px; /* Margin zamiast padding żeby nie wpływać na scroll */
    box-sizing: border-box;
}

/* Komunikat gdy brak itemów - używa absolutnego pozycjonowania aby wyjść z grida */
.sort-no-items-message {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #888;
    font-size: 11px;
    text-align: center;
    line-height: 1.5;
    width: calc(100% - 40px);
    max-width: 300px;
    padding: 20px;
    pointer-events: none;
}

.sort-empty-message {
    color: #888;
    font-size: 11px;
    text-align: center;
    line-height: 1.5;
    width: 100%;
}

.sort-item-slot {
    width: 32px; height: 32px;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}
.sort-item-slot:hover {
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15);
}
.sort-item-slot .item,
.sort-item-slot > div {
    position: relative !important;
    left: 0 !important; top: 0 !important;
    display: block !important;
}

/* Disable icon styles (nodepo, noauction) */
.sort-item-slot .item.disable-item-mark .canvas-icon,
.sort-item-slot .item.disable-item-mark .canvas-notice,
.sort-item-slot .item.disable-item-mark .cooldown,
.sort-item-slot .item.disable-item-mark .amount {
    opacity: 0.4;
}
.sort-item-slot .item .disable-icon {
    width: 15px;
    height: 15px;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: url("/img/gui/X-blackoutline.gif?v=9ba6b5fe1722a");
    z-index: 1;
}

/* ===== FILTER MODAL ===== */
.sort-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 50; /* Niższy niż tooltips gry, wyższy niż panel (10) */
    display: flex;
    align-items: center;
    justify-content: center;
}
.sort-modal {
    background: rgba(22,22,22,0.97);
    border: 1px solid rgba(100,100,100,0.4);
    border-radius: 5px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    width: 410px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 12px 14px;
    color: #ddd;
    font-size: 12px;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    scrollbar-width: thin;
    scrollbar-color: #d1d2d385 transparent;
    z-index: 51; /* Wyższy niż overlay (50), niższy niż tooltips gry */
}
.sort-modal::-webkit-scrollbar {
    width: 5px;
}
.sort-modal::-webkit-scrollbar-track {
    background: transparent;
}
.sort-modal::-webkit-scrollbar-thumb {
    background: #d1d2d385;
    border-radius: 14px;
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto;
}
.sort-modal::-webkit-scrollbar-thumb:hover {
    background: #d1d2d3b0;
}
.sort-modal h3 {
    margin: 0 0 10px; font-size: 13px; color: #eee; font-weight: 600;
}
.sort-modal-header {
    user-select: none;
}
.sort-modal-header:hover {
    background: rgba(0,0,0,0.4) !important;
}
.sort-modal label {
    display: block; margin: 8px 0 3px; color: #aaa; font-size: 11px;
}
.sort-modal input[type="text"] {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    padding: 5px 7px;
    color: #ddd; font-size: 11px; font-family: inherit;
    outline: none;
}
.sort-modal input[type="text"]:focus {
    border-color: rgba(120,180,255,0.4);
}

/* Operator buttons */
.sort-ops {
    display: flex; gap: 3px; margin: 5px 0;
}
.sort-op-btn {
    padding: 2px 7px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    color: #aaa; font-size: 11px; cursor: pointer;
    transition: background .12s;
}
.sort-op-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }

/* Available stats chips */
.sort-stats-label { color: #777; font-size: 10px; margin: 8px 0 3px; }
.sort-stats-chips {
    display: flex; flex-wrap: wrap; gap: 3px;
    max-height: 120px; overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #d1d2d385 transparent;
}
.sort-stats-chips::-webkit-scrollbar {
    width: 5px;
}
.sort-stats-chips::-webkit-scrollbar-track {
    background: transparent;
}
.sort-stats-chips::-webkit-scrollbar-thumb {
    background: #d1d2d385;
    border-radius: 14px;
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto;
}
.sort-stats-chips::-webkit-scrollbar-thumb:hover {
    background: #d1d2d3b0;
}

/* Filter preview */
.sort-filter-preview {
    scrollbar-width: thin;
    scrollbar-color: #d1d2d385 transparent;
}
.sort-filter-preview::-webkit-scrollbar {
    width: 5px;
}
.sort-filter-preview::-webkit-scrollbar-track {
    background: transparent;
}
.sort-filter-preview::-webkit-scrollbar-thumb {
    background: #d1d2d385;
    border-radius: 14px;
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto;
}
.sort-filter-preview::-webkit-scrollbar-thumb:hover {
    background: #d1d2d3b0;
}
.sort-chip {
    padding: 2px 6px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    color: #bbb; font-size: 10px; cursor: pointer;
    white-space: nowrap;
    transition: background .1s, color .1s;
}
.sort-chip:hover { background: rgba(120,180,255,0.15); color: #9cc5ff; border-color: rgba(120,180,255,0.3); }
.sort-chip.sort-chip-prop { color: #bbb; border-color: rgba(255,255,255,0.1); }

/* Icon preview */
.sort-icon-preview {
    width: 24px; height: 24px;
    margin-top: 4px;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px;
}

/* Modal buttons */
.sort-modal-btns {
    display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px;
}
.sort-modal-btn {
    padding: 4px 14px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 3px;
    color: #ccc; font-size: 11px; cursor: pointer;
    transition: background .12s;
}
.sort-modal-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
.sort-modal-btn.sort-btn-primary {
    background: rgba(70,130,200,0.25);
    border-color: rgba(70,130,200,0.4);
    color: #9cc5ff;
}
.sort-modal-btn.sort-btn-primary:hover {
    background: rgba(70,130,200,0.4);
}

/* Context menu */
.sort-ctx-menu {
    position: fixed;
    background: rgba(22,22,22,0.97);
    border: 1px solid rgba(100,100,100,0.4);
    border-radius: 3px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    z-index: 100;
    min-width: 100px;
    padding: 3px 0;
}
.sort-ctx-item {
    padding: 4px 12px;
    color: #ccc; font-size: 11px; cursor: pointer;
    white-space: nowrap;
}
.sort-ctx-item:hover { background: rgba(255,255,255,0.1); color: #fff; }
.sort-ctx-item.sort-ctx-danger { color: #e88; }
.sort-ctx-item.sort-ctx-danger:hover { background: rgba(200,60,60,0.15); color: #f99; }

/* Settings Modal */
.sort-settings-modal {
    background: rgba(22,22,22,0.97) !important;
    border: 1px solid rgba(100,100,100,0.4);
    border-radius: 5px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    width: 320px;
    max-height: none !important;
    overflow-y: visible !important;
    padding: 12px 14px;
    color: #ddd;
    font-size: 12px;
}
.sort-settings-modal h3 {
    margin: 0 0 10px;
    font-size: 13px;
    color: #eee;
    font-weight: 600;
}
.sort-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sort-settings-row:last-child { border-bottom: none; }
.sort-settings-label {
    color: #aaa;
    font-size: 11px;
    flex: 1;
}
.sort-settings-select {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    padding: 4px 8px;
    color: #ddd;
    font-size: 11px;
    font-family: inherit;
    outline: none;
    cursor: pointer;
}
.sort-settings-select:focus {
    border-color: rgba(120,180,255,0.4);
}
.sort-settings-select option {
    background: #1a1a1a;
    color: #ddd;
}
.sort-settings-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: rgba(120,180,255,0.8);
}
.sort-settings-input {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px;
    padding: 4px 8px;
    color: #ddd;
    font-size: 11px;
    font-family: inherit;
    outline: none;
}
.sort-settings-input:focus {
    border-color: rgba(120,180,255,0.4);
}

/* Deleted Filters Section */
.sort-settings-modal h4 {
    margin: 20px 0 10px;
    font-size: 12px;
    color: #fff;
    font-weight: 600;
}
.sort-deleted-filters-list {
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 15px;
    scrollbar-width: thin;
    scrollbar-color: #d1d2d385 transparent;
}
.sort-deleted-filters-list::-webkit-scrollbar { width: 5px; }
.sort-deleted-filters-list::-webkit-scrollbar-track { background: transparent; }
.sort-deleted-filters-list::-webkit-scrollbar-thumb {
    background: #d1d2d385;
    border-radius: 14px;
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto;
}
.sort-deleted-filters-list::-webkit-scrollbar-thumb:hover { background: #d1d2d3b0; }

/* Item names list and excluded list scrollbars */
.sort-item-names-list,
.sort-excluded-list {
    scrollbar-width: thin;
    scrollbar-color: #d1d2d385 transparent;
}
.sort-item-names-list::-webkit-scrollbar,
.sort-excluded-list::-webkit-scrollbar {
    width: 5px;
}
.sort-item-names-list::-webkit-scrollbar-track,
.sort-excluded-list::-webkit-scrollbar-track {
    background: transparent;
}
.sort-item-names-list::-webkit-scrollbar-thumb,
.sort-excluded-list::-webkit-scrollbar-thumb {
    background: #d1d2d385;
    border-radius: 14px;
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto;
}
.sort-item-names-list::-webkit-scrollbar-thumb:hover,
.sort-excluded-list::-webkit-scrollbar-thumb:hover {
    background: #d1d2d3b0;
}

/* Całkowite ukrycie natywnych scrollbarów (brak strzałek, brak zajmowania miejsca w oknie) */
.sort-hide-native-scroll,
.sort-filters,
.sort-modal,
.sort-stats-chips,
.sort-filter-preview,
.sort-item-names-list,
.sort-excluded-list,
.sort-deleted-filters-list,
.sort-custom-scroll-container,
#sortownik-panel,
#sortownik-panel *,
.sort-modal,
.sort-modal *,
#sort-settings-overlay,
#sort-settings-overlay * {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
}
.sort-hide-native-scroll::-webkit-scrollbar,
.sort-filters::-webkit-scrollbar,
.sort-modal::-webkit-scrollbar,
.sort-stats-chips::-webkit-scrollbar,
.sort-filter-preview::-webkit-scrollbar,
.sort-item-names-list::-webkit-scrollbar,
.sort-excluded-list::-webkit-scrollbar,
.sort-deleted-filters-list::-webkit-scrollbar,
.sort-custom-scroll-container::-webkit-scrollbar,
#sortownik-panel *::-webkit-scrollbar,
.sort-modal *::-webkit-scrollbar,
#sort-settings-overlay *::-webkit-scrollbar,
#sortownik-panel *::-webkit-scrollbar-button,
.sort-modal *::-webkit-scrollbar-button,
.sort-modal::-webkit-scrollbar-button,
#sort-settings-overlay *::-webkit-scrollbar-button,
::-webkit-scrollbar-button {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
}
::-webkit-scrollbar-corner {
    background: transparent !important;
}
/* Ukryj strzałki w polach liczbowych */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
input[type="number"] {
    -moz-appearance: textfield;
}
.sort-deleted-filter-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    background: rgba(0,0,0,0.3);
    margin-bottom: 5px;
    border-radius: 4px;
}
.sort-restore-btn {
    padding: 4px 8px;
    background: #4a9eff;
    color: #fff;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.2s;
}
.sort-restore-btn:hover {
    background: #5fb0ff;
}
.sort-permanent-delete-btn {
    padding: 4px 8px;
    background: #d9534f;
    color: #fff;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    transition: background 0.2s;
}
.sort-permanent-delete-btn:hover {
    background: #e6625f;
}

/* Margonem cursor dla interaktywnych elementów */
/* Kursor "do-action" (palec wskazujący) dla klikalnych elementów */
#sortownik-toggle,
.sort-tb-btn,
.sort-close,
.sort-filter-tab,
.sort-modal-btn,
.sort-op-btn,
.sort-chip,
.sort-settings-btn,
button,
input[type="checkbox"],
.sort-restore-btn,
.sort-permanent-delete-btn,
select,
input[type="text"],
input[type="number"],
.sort-titlebar,
.sort-modal-header,
.scrollbar-wrapper .track,
.scrollbar-wrapper .track .handle,
::-webkit-scrollbar-thumb,
*::-webkit-scrollbar-thumb,
.sort-filters::-webkit-scrollbar-thumb,
.sort-modal::-webkit-scrollbar-thumb,
.sort-stats-chips::-webkit-scrollbar-thumb,
.sort-filter-preview::-webkit-scrollbar-thumb,
.sort-item-names-list::-webkit-scrollbar-thumb,
.sort-excluded-list::-webkit-scrollbar-thumb,
.sort-deleted-filters-list::-webkit-scrollbar-thumb,
#sortownik-panel *::-webkit-scrollbar-thumb,
.sort-modal *::-webkit-scrollbar-thumb,
#sort-settings-overlay *::-webkit-scrollbar-thumb {
    cursor: url("/img/gui/cursor/5n.png?v=9ba6b5fe1722a") 4 0, url("/img/gui/cursor/5n.cur?v=9ba6b5fe1722a") 4 0, auto !important;
}

/* Aktywne przeciąganie - systemowy grabbing */
.sort-titlebar:active,
.sort-modal-header:active,
.scrollbar-wrapper .track .handle:active,
::-webkit-scrollbar-thumb:active,
*::-webkit-scrollbar-thumb:active,
.sort-filters::-webkit-scrollbar-thumb:active,
.sort-modal::-webkit-scrollbar-thumb:active,
.sort-stats-chips::-webkit-scrollbar-thumb:active,
.sort-filter-preview::-webkit-scrollbar-thumb:active,
.sort-item-names-list::-webkit-scrollbar-thumb:active,
.sort-excluded-list::-webkit-scrollbar-thumb:active,
.sort-deleted-filters-list::-webkit-scrollbar-thumb:active,
#sortownik-panel *::-webkit-scrollbar-thumb:active,
.sort-modal *::-webkit-scrollbar-thumb:active,
#sort-settings-overlay *::-webkit-scrollbar-thumb:active {
    cursor: grabbing !important;
}

/* Kursor domyślny (strzałka) dla tła i nieinteraktywnych elementów */
.sort-item-list:empty,
.sort-item-list:empty::after,
.sort-modal,
.sort-modal-overlay,
.sort-item-names-list,
.sort-deleted-filters-list,
#sort-settings-overlay,
label,
.sort-stats-label,
.sort-search-icon,
.sort-bag-slots,
.sort-item,
.sort-item-slot,
.sort-item-slot *,
.sort-item-list,
.scroll-pane,
.sort-hide-native-scroll,
.sort-search-wrap,
#sortownik-panel {
    cursor: url("/img/gui/cursor/1n.png?v=9ba6b5fe1722a"), url("/img/gui/cursor/1n.cur?v=9ba6b5fe1722a"), auto !important;
}
`;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ==================== TOGGLE BUTTON ====================

    let toggleBtnDragging = false;
    let toggleBtnOffset = { x: 0, y: 0 };

    function loadTogglePos() {
        return load(KEYS.togglePos, { x: 10, y: 100 });
    }

    function saveTogglePos(x, y) {
        save(KEYS.togglePos, { x, y });
    }

    function createToggleButton() {
        toggleBtn = document.createElement('div');
        toggleBtn.id = 'sortownik-toggle';

        // Ustaw ikonę torby zamiast tekstu
        toggleBtn.style.backgroundImage = 'url(https://micc.garmory-cdn.cloud/obrazki/itemy/bag/torba12.gif)';
        toggleBtn.style.backgroundSize = '32px 32px';
        toggleBtn.style.backgroundRepeat = 'no-repeat';
        toggleBtn.style.backgroundPosition = 'center';
        toggleBtn.style.width = '40px';
        toggleBtn.style.height = '40px';

        addTip(toggleBtn, 'Sortownik+<br>Przeciągnij aby przesunąć');

        // Wczytaj zapisaną pozycję
        const pos = loadTogglePos();
        toggleBtn.style.left = pos.x + 'px';
        toggleBtn.style.top = pos.y + 'px';

        // Kliknięcie - toggle panelu
        toggleBtn.addEventListener('click', (e) => {
            if (!toggleBtnDragging) {
                isVisible = !isVisible;
                save(KEYS.visible, isVisible);
                toggleBtn.classList.toggle('sort-active', isVisible);
                if (isVisible) showPanel(); else hidePanel();
            }
        });

        // Przeciąganie przycisku
        toggleBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            toggleBtnDragging = false;
            const rect = toggleBtn.getBoundingClientRect();
            toggleBtnOffset.x = e.clientX - rect.left;
            toggleBtnOffset.y = e.clientY - rect.top;

            const startX = e.clientX;
            const startY = e.clientY;

            const onMove = (e) => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                // Jeśli przesunięto więcej niż 5px, to przeciąganie
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    toggleBtnDragging = true;
                }

                if (toggleBtnDragging) {
                    let newX = e.clientX - toggleBtnOffset.x;
                    let newY = e.clientY - toggleBtnOffset.y;

                    // Ogranicz do granic okna
                    newX = Math.max(0, Math.min(newX, window.innerWidth - toggleBtn.offsetWidth));
                    newY = Math.max(0, Math.min(newY, window.innerHeight - toggleBtn.offsetHeight));

                    toggleBtn.style.left = newX + 'px';
                    toggleBtn.style.top = newY + 'px';
                }
            };

            const onUp = (e) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                if (toggleBtnDragging) {
                    const x = parseInt(toggleBtn.style.left);
                    const y = parseInt(toggleBtn.style.top);
                    saveTogglePos(x, y);

                    // Zresetuj flagę po krótkiej chwili, żeby nie triggerować kliknięcia
                    setTimeout(() => { toggleBtnDragging = false; }, 100);
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        document.body.appendChild(toggleBtn);
    }

    // ==================== CUSTOM OVERLAY SCROLLBAR (MARGONEM STYLE) ====================

    function initCustomScrollBar(wrapper, options = {}) {
        if (!wrapper) return;
        const axis = options.axis || 'y';
        const isHoriz = axis === 'x';

        // Upewnij się, że wrapper ma pozycjonowanie dla absolutnego paska scrolla
        try {
            const compPos = window.getComputedStyle(wrapper).position;
            if (compPos === 'static') {
                wrapper.style.position = 'relative';
            }
        } catch(e) {}

        wrapper.classList.add('sort-custom-scroll-container');

        // Dla poziomego scrolla używamy scroll-pane jako pane, dla pionowego sprawdzamy czy jest osobny
        const isPaneSeparate = !isHoriz && !!wrapper.querySelector('.scroll-pane');
        const pane = (isHoriz || isPaneSeparate) ? wrapper.querySelector('.scroll-pane') : wrapper;
        pane.classList.add('sort-hide-native-scroll');

        function bindDragAndClick(sb) {
            const track = sb.querySelector('.track');
            const handle = sb.querySelector('.handle');
            if (!track || !handle) return;

            let isDragging = false;
            let startCoord = 0;
            let startScroll = 0;

            handle.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                isDragging = true;
                startCoord = isHoriz ? e.clientX : e.clientY;
                startScroll = isHoriz ? pane.scrollLeft : pane.scrollTop;
                handle.setPointerCapture(e.pointerId);
            });

            handle.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                e.stopPropagation();
                e.preventDefault();
                if (isHoriz) {
                    const deltaX = e.clientX - startCoord;
                    const trackWidth = track.clientWidth || pane.clientWidth;
                    const handleWidth = handle.offsetWidth || 36;
                    const maxHandleLeft = trackWidth - handleWidth;
                    const maxScroll = pane.scrollWidth - pane.clientWidth;
                    if (maxHandleLeft > 0 && maxScroll > 0) {
                        pane.scrollLeft = startScroll + (deltaX / maxHandleLeft) * maxScroll;
                        update();
                    }
                } else {
                    const deltaY = e.clientY - startCoord;
                    const trackHeight = track.clientHeight || pane.clientHeight;
                    const handleHeight = handle.offsetHeight || 44;
                    const maxHandleTop = trackHeight - handleHeight;
                    const maxScroll = pane.scrollHeight - pane.clientHeight;
                    if (maxHandleTop > 0 && maxScroll > 0) {
                        pane.scrollTop = startScroll + (deltaY / maxHandleTop) * maxScroll;
                        update();
                    }
                }
            });

            const stopDrag = (e) => {
                if (!isDragging) return;
                isDragging = false;
                try { handle.releasePointerCapture(e.pointerId); } catch(err) {}
            };
            handle.addEventListener('pointerup', stopDrag);
            handle.addEventListener('pointercancel', stopDrag);

            track.addEventListener('pointerdown', (e) => {
                if (e.target === handle) return;
                e.stopPropagation();
                e.preventDefault();
                const rect = track.getBoundingClientRect();
                if (isHoriz) {
                    const clickX = e.clientX - rect.left;
                    const trackWidth = track.clientWidth || pane.clientWidth;
                    const handleWidth = handle.offsetWidth || 36;
                    const maxHandleLeft = trackWidth - handleWidth;
                    const maxScroll = pane.scrollWidth - pane.clientWidth;
                    if (maxHandleLeft > 0 && maxScroll > 0) {
                        const targetRatio = (clickX - handleWidth / 2) / maxHandleLeft;
                        pane.scrollLeft = Math.max(0, Math.min(maxScroll, targetRatio * maxScroll));
                        update();
                    }
                } else {
                    const clickY = e.clientY - rect.top;
                    const trackHeight = track.clientHeight || pane.clientHeight;
                    const handleHeight = handle.offsetHeight || 44;
                    const maxHandleTop = trackHeight - handleHeight;
                    const maxScroll = pane.scrollHeight - pane.clientHeight;
                    if (maxHandleTop > 0 && maxScroll > 0) {
                        const targetRatio = (clickY - handleHeight / 2) / maxHandleTop;
                        pane.scrollTop = Math.max(0, Math.min(maxScroll, targetRatio * maxScroll));
                        update();
                    }
                }
            });
        }

        function getScrollBar() {
            let sb = wrapper.querySelector(isHoriz ? ':scope > .scrollbar-wrapper--horizontal' : ':scope > .scrollbar-wrapper:not(.scrollbar-wrapper--horizontal)');
            if (!sb) {
                sb = document.createElement('div');
                sb.className = 'scrollbar-wrapper' + (isHoriz ? ' scrollbar-wrapper--horizontal' : '');
                sb.innerHTML = '<div class="track"><div class="handle"></div></div>';
                wrapper.appendChild(sb);
                bindDragAndClick(sb);
            }
            return sb;
        }

        function update() {
            if (!pane) return;
            const sbWrapper = getScrollBar();
            const track = sbWrapper.querySelector('.track');
            const handle = sbWrapper.querySelector('.handle');
            if (!track || !handle) return;

            if (isHoriz) {
                const scrollWidth = pane.scrollWidth;
                const clientWidth = pane.clientWidth;
                const canScroll = (scrollWidth - clientWidth) > 1;

                if (canScroll) {
                    wrapper.classList.add('scrollable');
                    sbWrapper.style.display = 'block';

                    const maxScroll = scrollWidth - clientWidth;
                    const ratio = maxScroll > 0 ? (pane.scrollLeft / maxScroll) : 0;
                    const trackWidth = track.clientWidth || clientWidth;
                    const handleWidth = handle.offsetWidth || 36;
                    const maxHandleLeft = trackWidth - handleWidth;
                    if (maxHandleLeft > 0) {
                        handle.style.left = Math.max(0, Math.min(maxHandleLeft, Math.round(ratio * maxHandleLeft))) + 'px';
                    }
                } else {
                    wrapper.classList.remove('scrollable');
                    sbWrapper.style.display = 'none';
                }
            } else {
                const scrollHeight = pane.scrollHeight;
                const clientHeight = pane.clientHeight;
                const canScroll = (scrollHeight - clientHeight) > 1;

                if (canScroll) {
                    wrapper.classList.add('scrollable');
                    sbWrapper.style.display = 'block';

                    if (!isPaneSeparate) {
                        sbWrapper.style.top = pane.scrollTop + 'px';
                        sbWrapper.style.height = clientHeight + 'px';
                    }

                    const maxScroll = scrollHeight - clientHeight;
                    const ratio = maxScroll > 0 ? (pane.scrollTop / maxScroll) : 0;
                    const trackHeight = track.clientHeight || clientHeight;
                    const handleHeight = handle.offsetHeight || 44;
                    const maxHandleTop = trackHeight - handleHeight;
                    if (maxHandleTop > 0) {
                        handle.style.top = Math.max(0, Math.min(maxHandleTop, Math.round(ratio * maxHandleTop))) + 'px';
                    }
                } else {
                    wrapper.classList.remove('scrollable');
                    sbWrapper.style.display = 'none';
                }
            }
        }

        // Kółko myszy
        wrapper.addEventListener('wheel', (e) => {
            if (isHoriz) {
                if (pane.scrollWidth > pane.clientWidth) {
                    const delta = e.deltaY || e.deltaX || 0;
                    if (delta !== 0) {
                        pane.scrollLeft += delta;
                        e.preventDefault();
                    }
                    e.stopPropagation();
                    update();
                }
            } else {
                if (pane.scrollHeight > pane.clientHeight) {
                    e.stopPropagation();
                    e.preventDefault();

                    // Scroll o jedną linię przedmiotów (32px + 1px gap = 33px)
                    const rowHeight = 33;
                    const delta = e.deltaY || 0;
                    const scrollAmount = delta > 0 ? rowHeight : -rowHeight;

                    pane.scrollTop += scrollAmount;
                    update();
                }
            }
        }, { passive: false });

        pane.addEventListener('scroll', update, { passive: true });

        $(wrapper).on('update updateBarPos', update);
        wrapper.addEventListener('update', update);
        wrapper._updateScrollBar = update;

        requestAnimationFrame(update);
    }

    // ==================== PANEL ====================

    function createPanel() {
        panelEl = document.createElement('div');
        panelEl.id = 'sortownik-panel';

        const position = settings.filtersPosition || 'top';
        const isHorizontal = position === 'left' || position === 'right';

        // Ustaw szerokość panelu w zależności od orientacji
        if (isHorizontal) {
            const savedWidth = settings.panelWidth || 282;
            panelEl.style.width = savedWidth + 'px'; // Użyj zapisanej szerokości lub domyślnej
        } else {
            const savedWidth = settings.panelWidth || 246;
            panelEl.style.width = savedWidth + 'px'; // Użyj zapisanej szerokości lub domyślnej
        }

        // Ustaw wysokość panelu z zapisanych ustawień
        const savedHeight = settings.maxHeight || 400;
        panelEl.style.maxHeight = savedHeight + 'px';
        panelEl.style.minHeight = savedHeight + 'px';

        // Titlebar
        const tb = document.createElement('div');
        tb.className = 'sort-titlebar';

        const addBtn = document.createElement('div');
        addBtn.className = 'sort-tb-btn';
        addBtn.textContent = '+';
        addTip(addBtn, 'Dodaj filtr');
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); showFilterModal(); });

        const toggleFiltersBtn = document.createElement('div');
        toggleFiltersBtn.className = 'sort-tb-btn';
        toggleFiltersBtn.id = 'sort-toggle-filters-btn';
        toggleFiltersBtn.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 11 L4 7 L12 7 Z"/></svg>';
        addTip(toggleFiltersBtn, 'Ukryj/Pokaż filtry');
        toggleFiltersBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settings.filtersVisible = !settings.filtersVisible;
            save(KEYS.settings, settings);
            updateFiltersVisibility();
        });

        const settingsBtn = document.createElement('div');
        settingsBtn.className = 'sort-tb-btn';
        settingsBtn.textContent = '⚙';
        addTip(settingsBtn, 'Ustawienia');
        settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); showSettingsModal(); });

        const title = document.createElement('div');
        title.className = 'sort-title';
        title.textContent = 'Sortownik+';

        const lockBtn = document.createElement('div');
        lockBtn.className = 'sort-tb-btn';
        lockBtn.id = 'sort-lock-btn';
        lockBtn.innerHTML = '<svg viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7 V5 C5.5 3.3 6.8 2 8 2 C9.2 2 10.5 3.3 10.5 5 V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
        addTip(lockBtn, 'Zablokuj/Odblokuj pozycję okna');
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isPanelLocked = !isPanelLocked;
            settings.isPanelLocked = isPanelLocked;
            save(KEYS.settings, settings);
            updateLockButton();
        });

        // Przycisk opacity
        const opacityBtn = document.createElement('div');
        opacityBtn.className = 'sort-tb-btn';
        opacityBtn.id = 'sort-opacity-btn';
        opacityBtn.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
        addTip(opacityBtn, 'Krycie tła: 4/5');
        opacityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settings.panelOpacity = (settings.panelOpacity % 5) + 1; // Cykl 1-5
            save(KEYS.settings, settings);
            console.log('[Sortownik] Opacity changed to:', settings.panelOpacity);
            updatePanelOpacity();
        });

        const closeBtn = document.createElement('div');
        closeBtn.className = 'sort-tb-btn';
        closeBtn.textContent = '×';
        addTip(closeBtn, 'Zamknij');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isVisible = false;
            save(KEYS.visible, false);
            toggleBtn.classList.remove('sort-active');
            hidePanel();
        });

        tb.appendChild(addBtn);
        tb.appendChild(toggleFiltersBtn);
        tb.appendChild(settingsBtn);

        // Spacer - wypycha przycisk zamknij na prawo
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        tb.appendChild(spacer);

        tb.appendChild(title);
        tb.appendChild(opacityBtn);
        tb.appendChild(lockBtn);
        tb.appendChild(closeBtn);

        // Dragging
        tb.addEventListener('mousedown', startDrag);

        // Główny kontener poziomy
        const mainContent = document.createElement('div');
        mainContent.className = 'sort-main-content';

        // === LEWA STRONA - Filtry ===
        const filtersColumn = document.createElement('div');
        filtersColumn.className = 'sort-filters-column';

        const filtersScrollWrapper = document.createElement('div');
        filtersScrollWrapper.className = 'sort-custom-scroll-container sort-filters-wrapper';

        const filtersScrollPane = document.createElement('div');
        filtersScrollPane.className = 'scroll-pane';

        const filtersRow = document.createElement('div');
        filtersRow.className = 'sort-filters';
        filtersRow.id = 'sort-filters-row';

        filtersScrollPane.appendChild(filtersRow);
        filtersScrollWrapper.appendChild(filtersScrollPane);
        filtersColumn.appendChild(filtersScrollWrapper);

        // === PRAWA STRONA - Search + Lista itemów ===
        const rightPanel = document.createElement('div');
        rightPanel.className = 'sort-right-panel';

        // Search
        const searchWrap = document.createElement('div');
        searchWrap.className = 'sort-search-wrap';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'sort-search-icon';
        searchIcon.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="5"/><line x1="10" y1="10" x2="15" y2="15"/></svg>';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'sort-search-input';
        searchInput.placeholder = 'Szukaj';
        addTip(searchInput, 'Wyszukaj przedmioty po nazwie lub opisie');
        searchInput.addEventListener('input', () => {
            searchValue = searchInput.value.trim().toLowerCase();
            refreshItems();
        });
        const bagSlots = document.createElement('span');
        bagSlots.className = 'sort-bag-slots';
        bagSlots.id = 'sort-bag-slots';
        bagSlots.textContent = '0m';
        searchWrap.appendChild(searchIcon);
        searchWrap.appendChild(searchInput);
        searchWrap.appendChild(bagSlots);

        // Item list (inside scroll-wrapper > scroll-pane for Margonem-style overlay scrollbar)
        const scrollWrapper = document.createElement('div');
        scrollWrapper.className = 'sort-scroll-wrapper scroll-wrapper';

        const scrollPane = document.createElement('div');
        scrollPane.className = 'scroll-pane';

        const itemList = document.createElement('div');
        itemList.className = 'sort-item-list';
        itemList.id = 'sort-item-list';

        scrollPane.appendChild(itemList);
        scrollWrapper.appendChild(scrollPane);

        // Buduj layout w zależności od pozycji filtrów (używamy już zadeklarowanej zmiennej position z góry funkcji)
        if (position === 'left') {
            // Filtry po lewej, reszta po prawej
            mainContent.className = 'sort-main-content sort-layout-horizontal';
            filtersColumn.className = 'sort-filters-column sort-filters-left';
            // Nie używaj inline styles - wykorzystaj klasy CSS

            rightPanel.appendChild(searchWrap);
            rightPanel.appendChild(scrollWrapper);

            mainContent.appendChild(filtersColumn);
            mainContent.appendChild(rightPanel);
        } else if (position === 'right') {
            // Reszta po lewej, filtry po prawej
            mainContent.className = 'sort-main-content sort-layout-horizontal';
            filtersColumn.className = 'sort-filters-column sort-filters-right';
            // Nie używaj inline styles - wykorzystaj klasy CSS

            rightPanel.appendChild(searchWrap);
            rightPanel.appendChild(scrollWrapper);

            mainContent.appendChild(rightPanel);
            mainContent.appendChild(filtersColumn);
        } else if (position === 'top') {
            // Filtry na górze, reszta na dole
            mainContent.className = 'sort-main-content sort-layout-vertical';
            const filtersWrapper = document.createElement('div');
            filtersWrapper.className = 'sort-filters-top-wrapper';
            filtersWrapper.id = 'sort-filters-wrapper'; // ID dla łatwiejszego dostępu
            filtersWrapper.style.cssText = 'position: relative; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.06); width: 100%;';
            filtersScrollPane.style.cssText = 'height: 100%; overflow-x: auto; overflow-y: hidden; width: 100%;';
            filtersRow.classList.add('sort-filters-horizontal'); // Dodaj klasę zamiast inline
            filtersScrollWrapper.className = 'sort-custom-scroll-container';
            filtersWrapper.appendChild(filtersScrollWrapper);

            mainContent.appendChild(filtersWrapper);
            mainContent.appendChild(searchWrap);
            mainContent.appendChild(scrollWrapper);

            // Dla top: konwertuj scroll w pionie na poziomy
            filtersScrollPane.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    filtersScrollPane.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
                e.stopPropagation();
            });
        } else if (position === 'bottom') {
            // Reszta na górze, filtry na dole
            mainContent.className = 'sort-main-content sort-layout-vertical';
            const filtersWrapper = document.createElement('div');
            filtersWrapper.className = 'sort-filters-bottom-wrapper';
            filtersWrapper.id = 'sort-filters-wrapper'; // ID dla łatwiejszego dostępu
            filtersWrapper.style.cssText = 'position: relative; flex-shrink: 0; border-top: 1px solid rgba(255,255,255,0.06); width: 100%;';
            filtersScrollPane.style.cssText = 'height: 100%; overflow-x: auto; overflow-y: hidden; width: 100%;';
            filtersRow.classList.add('sort-filters-horizontal'); // Dodaj klasę zamiast inline
            filtersScrollWrapper.className = 'sort-custom-scroll-container';
            filtersWrapper.appendChild(filtersScrollWrapper);

            mainContent.appendChild(searchWrap);
            mainContent.appendChild(scrollWrapper);
            mainContent.appendChild(filtersWrapper);

            // Dla bottom: konwertuj scroll w pionie na poziomy
            filtersScrollPane.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    filtersScrollPane.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
                e.stopPropagation();
            });
        }

        panelEl.appendChild(tb);
        panelEl.appendChild(mainContent);

        // Dodaj uchwyt do resize'u
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'sort-resize-handle';
        resizeHandle.addEventListener('mousedown', startResize);
        panelEl.appendChild(resizeHandle);

        document.body.appendChild(panelEl);

        // Inicjalizacja scrollbarów w stylu Margonem
        initCustomScrollBar(scrollWrapper); // pionowy dla listy itemów

        if (position === 'left' || position === 'right') {
            initCustomScrollBar(filtersScrollWrapper); // pionowy dla paska filtrów po bokach
        } else {
            initCustomScrollBar(filtersScrollWrapper, { axis: 'x' }); // poziomy dla paska filtrów top/bottom
        }

        // Pozycja z pamięci
        const pos = load(KEYS.pos, { x: 200, y: 100 });
        panelEl.style.left = pos.x + 'px';
        panelEl.style.top  = pos.y + 'px';
    }

    function setupPanelDroppable() {
        if (!panelEl) return;

        try {
            const itemList = panelEl.querySelector('.sort-item-list');

            // Ustaw droppable na liście itemów dla dzielenia i stackowania
            if (itemList) {
                $(itemList).pointerDroppable({
                    accept: '.item:not(.shop-item)',
                    drop: (e, ui) => {
                        try {
                            const draggedItem = ui.draggable.data('item');
                            if (!draggedItem) return;

                            // Sprawdź czy to dzielenie (Shift był trzymany)
                            const isSplitting = ui.helper.data('splitting');

                            if (isSplitting && draggedItem.issetAmountStat && draggedItem.issetAmountStat()) {
                                const amount = parseInt(draggedItem.getAmountStat());
                                if (amount > 1) {
                                    // Sprawdź czy można dzielić
                                    if (parseInt(draggedItem.getCansplitStat && draggedItem.getCansplitStat()) === 0) {
                                        mAlert(_t('this_item_cant_split', null, 'item'));
                                        return;
                                    }

                                    // Sprawdź czy ma capacity lub jest strzałą
                                    const canSplit = draggedItem.getCapacityStat && draggedItem.getCapacityStat() ||
                                                   (typeof ItemClass !== 'undefined' && ItemClass.isArrowsCl && ItemClass.isArrowsCl(draggedItem.cl));

                                    if (!canSplit) {
                                        mAlert(_t('this_item_cant_split', null, 'item'));
                                        return;
                                    }

                                    // Pokaż dialog z pytaniem o ilość do podzielenia
                                    const amount = parseInt(draggedItem.getAmountStat());
                                    const maxAmount = amount - 1;

                                    const message = _t('item_split %max%', {'%max%': maxAmount}, 'item');
                                    const inputHtml = '<div class="input-wrapper"><input id="divide-items" class="default" placeholder="..." /></div>';

                                    mAlert(message + inputHtml, [{
                                        txt: 'Ok',
                                        callback: function() {
                                            const $input = $('#divide-items');
                                            if (!$input.length) return true;

                                            let value = $input.val().trim().replace(/\s/g, '');

                                            // Parsuj wartość z k/m/g
                                            let numValue = parseFloat(value);
                                            if (value.toLowerCase().includes('k')) numValue *= 1000;
                                            else if (value.toLowerCase().includes('m')) numValue *= 1000000;
                                            else if (value.toLowerCase().includes('g')) numValue *= 1000000000;
                                            numValue = Math.floor(numValue);

                                            // Walidacja
                                            if (isNaN(numValue) || numValue < 1 || numValue >= amount) {
                                                mAlert(_t('split_bad_value', null, 'item'));
                                                return false;
                                            }

                                            // Wyślij request z findslot=1 aby znaleźć wolne miejsce
                                            _g('moveitem&findslot=1&st=0&id=' + draggedItem.id + '&x=0&y=0&split=' + numValue);
                                            return true;
                                        }
                                    }, {
                                        txt: _t('cancel', null, 'buttons'),
                                        callback: function() {
                                            return true;
                                        }
                                    }], function(w) {
                                        const $input = w.$.find('.default');
                                        w.$.addClass('askAlert');

                                        if (typeof setInputMask === 'function' && typeof InputMaskData !== 'undefined') {
                                            setInputMask($input, InputMaskData.TYPE.NUMBER_WITH_KMG);
                                        }

                                        if (typeof mobileCheck === 'function' && !mobileCheck()) {
                                            setTimeout(() => $input.focus(), 100);
                                        }
                                    });

                                    e.stopPropagation();
                                    return;
                                }
                            }
                        } catch(ex) {
                            console.error('[Sortownik] Drop on list error:', ex);
                        }
                    }
                });
            }

            // Ustaw droppable na panelu aby przyjmował przeciągane przedmioty
            $(panelEl).pointerDroppable({
                accept: '.item:not(.shop-item)',
                over: () => {
                    try {
                        if (Engine.map && Engine.map.$worldPane) {
                            Engine.map.$worldPane.pointerDroppable({ accept: null });
                        }
                    } catch(e) {}
                },
                out: (e, ui) => {
                    try {
                        if (Engine.map && Engine.map.$worldPane) {
                            Engine.map.groundItems.initDrop();
                        }
                    } catch(e) {}
                },
                drop: (e, ui) => {
                    try {
                        if (Engine.map && Engine.map.$worldPane) {
                            Engine.map.groundItems.initDrop();
                        }
                    } catch(e) {}
                }
            });
        } catch(e) {
            console.error('[Sortownik] Błąd przy setupPanelDroppable:', e);
        }
    }

    function showPanel() {
        if (!panelEl) return;
        panelEl.classList.add('sort-show');
        renderFilterTabs();
        refreshItems();
        updateFiltersVisibility();
        updateLockButton(); // Zaktualizuj ikonę zamka
        updatePanelOpacity(); // Zaktualizuj przezroczystość tła
        updateFilterRows(); // Zaktualizuj ilość wierszy filtrów
        updateFilterScale(); // Zaktualizuj skalowanie filtrów
        updateBagSlotsDisplay();
        setupPanelDroppable();
        requestAnimationFrame(() => {
            const sw = panelEl.querySelector('.sort-scroll-wrapper');
            if (sw && sw._updateScrollBar) sw._updateScrollBar();
        });
    }

    function updateFiltersVisibility() {
        const position = settings.filtersPosition || 'top';
        let filtersEl = null;

        if (position === 'left' || position === 'right') {
            filtersEl = panelEl?.querySelector('.sort-filters-column');
        } else if (position === 'top') {
            filtersEl = panelEl?.querySelector('.sort-filters-top-wrapper');
        } else if (position === 'bottom') {
            filtersEl = panelEl?.querySelector('.sort-filters-bottom-wrapper');
        }

        const toggleBtn = document.getElementById('sort-toggle-filters-btn');
        if (!filtersEl || !toggleBtn) return;

        if (settings.filtersVisible) {
            filtersEl.style.display = (position === 'left' || position === 'right') ? 'flex' : 'block';
            toggleBtn.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 11 L4 7 L12 7 Z"/></svg>';
        } else {
            filtersEl.style.display = 'none';
            toggleBtn.innerHTML = '<svg viewBox="0 0 16 16"><path d="M7 4 L11 8 L7 12 Z"/></svg>';
        }
    }

    function hidePanel() {
        if (!panelEl) return;
        panelEl.classList.remove('sort-show');
    }

    function recreatePanel() {
        // Zapisz stan przed usunięciem
        const wasVisible = isVisible;
        const currentPos = panelEl ? {
            x: parseInt(panelEl.style.left) || 200,
            y: parseInt(panelEl.style.top) || 100
        } : load(KEYS.pos, { x: 200, y: 100 });

        // Usuń stary panel
        if (panelEl) {
            panelEl.remove();
            panelEl = null;
        }

        // Stwórz nowy panel
        createPanel();

        // Przywróć pozycję
        panelEl.style.left = currentPos.x + 'px';
        panelEl.style.top = currentPos.y + 'px';

        // Przywróć widoczność
        if (wasVisible) {
            showPanel();
        }

        // Odśwież zakładki filtrów i listę itemów
        renderFilterTabs();
        refreshItems();
        updateFilterCounts();
        updateFiltersVisibility();
    }

    // ==================== DRAGGING ====================

    function updateLockButton() {
        const lockBtn = document.getElementById('sort-lock-btn');
        if (!lockBtn) return;

        const titlebar = panelEl?.querySelector('.sort-titlebar');

        if (isPanelLocked) {
            // Zamknięta kłódka
            lockBtn.innerHTML = '<svg viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7 V5 C5.5 3.3 6.8 2 8 2 C9.2 2 10.5 3.3 10.5 5 V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
            lockBtn.style.color = '#4a9eff'; // Niebieski gdy zablokowane
            addTip(lockBtn, 'Odblokuj pozycję okna');
            if (titlebar) titlebar.classList.add('locked');
        } else {
            // Otwarta kłódka
            lockBtn.innerHTML = '<svg viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7 V5 C5.5 3.3 6.8 2 8 2 C9.2 2 10.5 3.3 10.5 5 V6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
            lockBtn.style.color = '#888'; // Szary gdy odblokowane
            addTip(lockBtn, 'Zablokuj pozycję okna');
            if (titlebar) titlebar.classList.remove('locked');
        }
    }

    function updatePanelOpacity() {
        const opacityBtn = document.getElementById('sort-opacity-btn');
        if (!opacityBtn) return;

        const level = settings.panelOpacity || 4;
        addTip(opacityBtn, `Krycie tła: ${level}/5`);

        // Ustaw opacity dla panelu (0.52 do 1.0)
        // Poziom 1 = 0.52, 2 = 0.64, 3 = 0.76, 4 = 0.88, 5 = 1.0
        const opacityValue = 0.40 + (level * 0.12);

        if (panelEl) {
            panelEl.style.setProperty('background', `rgba(14, 14, 14, ${opacityValue})`, 'important');
        }
    }

    function updateFilterRows() {
        const filtersRow = document.getElementById('sort-filters-row');
        const filtersColumn = document.querySelector('.sort-filters-column');
        const filtersWrapper = document.getElementById('sort-filters-wrapper');
        if (!filtersRow) return;

        const position = settings.filtersPosition || 'top';
        const rows = settings.filterRows || 1;

        // Zawijanie działa dla wszystkich pozycji
        if (rows === 2) {
            filtersRow.classList.add('sort-filters-wrap');
            // Dla top/bottom zachowaj klasę horizontal (potrzebna dla paddingu)

            // Dla left/right: poszerz kolumnę aby zmieściła 2 ikony
            if ((position === 'left' || position === 'right') && filtersColumn) {
                filtersColumn.classList.add('sort-filters-column-wide');
            }

            // Dla top/bottom: zwiększ wysokość wrappera
            if ((position === 'top' || position === 'bottom') && filtersWrapper) {
                filtersWrapper.classList.add('sort-wrapper-tall');
            }
        } else {
            filtersRow.classList.remove('sort-filters-wrap');

            // Przywróć normalną szerokość kolumny
            if (filtersColumn) {
                filtersColumn.classList.remove('sort-filters-column-wide');
            }

            // Przywróć normalną wysokość wrappera
            if (filtersWrapper) {
                filtersWrapper.classList.remove('sort-wrapper-tall');
            }
        }
    }

    function updateFilterScale() {
        const filtersRow = document.getElementById('sort-filters-row');
        const filtersColumn = document.querySelector('.sort-filters-column');
        const filtersWrapper = document.getElementById('sort-filters-wrapper');

        const scale = settings.filterScale || 100;
        const position = settings.filtersPosition || 'top';
        const rows = settings.filterRows || 1;

        // Zaktualizuj klasy na wszystkich tabach
        const tabs = document.querySelectorAll('.sort-filter-tab');
        tabs.forEach(tab => {
            tab.classList.remove('sort-filter-small', 'sort-filter-medium');
            if (scale === 50) {
                tab.classList.add('sort-filter-small');
            } else if (scale === 75) {
                tab.classList.add('sort-filter-medium');
            }
        });

        // Zaktualizuj klasy na filtersRow
        if (filtersRow) {
            filtersRow.classList.remove('sort-filters-small', 'sort-filters-medium');
            if (scale === 50) {
                filtersRow.classList.add('sort-filters-small');
            } else if (scale === 75) {
                filtersRow.classList.add('sort-filters-medium');
            }
        }

        // Zaktualizuj klasy na kolumnie (left/right)
        if (filtersColumn) {
            filtersColumn.classList.remove('sort-filters-column-small', 'sort-filters-column-medium');
            if (scale === 50) {
                filtersColumn.classList.add('sort-filters-column-small');
            } else if (scale === 75) {
                filtersColumn.classList.add('sort-filters-column-medium');
            }
        }

        // Zaktualizuj klasy na wrapperze (top/bottom)
        if (filtersWrapper) {
            filtersWrapper.classList.remove('sort-wrapper-small', 'sort-wrapper-medium');
            if (scale === 50) {
                filtersWrapper.classList.add('sort-wrapper-small');
            } else if (scale === 75) {
                filtersWrapper.classList.add('sort-wrapper-medium');
            }

            // WAŻNE: Jeśli mamy 2 wiersze (rows === 2), upewnij się że wrapper ma klasę .sort-wrapper-tall
            // To jest potrzebne gdy zmieniamy scale przy włączonych 2 wierszach
            if (rows === 2 && (position === 'top' || position === 'bottom')) {
                filtersWrapper.classList.add('sort-wrapper-tall');
            }
        }
    }

    function startDrag(e) {
        if (e.target.closest('.sort-tb-btn')) return;
        if (e.target.closest('.sort-resize-handle')) return; // Nie przeciągaj gdy resize
        if (isPanelLocked) return; // Nie przeciągaj gdy zablokowane
        isDragging = true;
        const rect = panelEl.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
    }

    function onDrag(e) {
        if (!isDragging) return;

        // Oblicz wymiary panelu
        const panelWidth = panelEl.offsetWidth;
        const panelHeight = panelEl.offsetHeight;

        // Ogranicz pozycję aby panel nie wyjeżdżał poza ekran
        const minX = 0;
        const maxX = window.innerWidth - panelWidth;
        const minY = 0;
        const maxY = window.innerHeight - panelHeight;

        const x = Math.max(minX, Math.min(maxX, e.clientX - dragOffset.x));
        const y = Math.max(minY, Math.min(maxY, e.clientY - dragOffset.y));

        panelEl.style.left = x + 'px';
        panelEl.style.top  = y + 'px';
    }

    function endDrag() {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);
        save(KEYS.pos, {
            x: parseInt(panelEl.style.left),
            y: parseInt(panelEl.style.top),
        });
    }

    // ==================== RESIZING ====================

    function startResize(e) {
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;
        resizeStartWidth = panelEl.offsetWidth;
        resizeStartHeight = panelEl.offsetHeight;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', endResize);
        document.body.style.cursor = 'nwse-resize';
    }

    function onResize(e) {
        if (!isResizing) return;

        const position = settings.filtersPosition || 'top';
        const isHorizontal = position === 'left' || position === 'right';

        const deltaX = e.clientX - resizeStartX;
        const deltaY = e.clientY - resizeStartY;

        if (isHorizontal) {
            // Dla left/right: tylko szerokość prawej części (nie całego panelu)
            const newWidth = Math.max(203, resizeStartWidth + deltaX); // Min 203px
            panelEl.style.width = newWidth + 'px';
        } else {
            // Dla top/bottom: pełna szerokość
            const newWidth = Math.max(203, resizeStartWidth + deltaX); // Min 203px
            panelEl.style.width = newWidth + 'px';
        }

        const newHeight = Math.max(150, resizeStartHeight + deltaY); // Min 150px
        panelEl.style.maxHeight = newHeight + 'px';
        panelEl.style.minHeight = newHeight + 'px';

        // Odśwież scrollbary
        requestAnimationFrame(() => {
            const sw = panelEl.querySelector('.sort-scroll-wrapper');
            if (sw && sw._updateScrollBar) sw._updateScrollBar();

            const filtersWrapper = panelEl.querySelector('.sort-custom-scroll-container.sort-filters-wrapper');
            if (filtersWrapper && filtersWrapper._updateScrollBar) filtersWrapper._updateScrollBar();
        });
    }

    function endResize() {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', endResize);
        document.body.style.cursor = '';

        // Zapisz nowy rozmiar
        // offsetHeight zawiera content + padding + border
        // Ale maxHeight/minHeight odnosi się tylko do content (bez padding/border gdy box-sizing: content-box)
        // Panel ma: border: 1px (góra) + 1px (dół) = 2px, padding-bottom: 3px
        // Więc musimy odjąć 5px aby zapisać rzeczywistą wysokość content
        const borderAndPadding = 5; // 2px border + 3px padding-bottom
        settings.maxHeight = panelEl.offsetHeight - borderAndPadding;
        settings.panelWidth = panelEl.offsetWidth; // Zapisz także szerokość
        save(KEYS.settings, settings);
    }

    // ==================== FILTER TABS ====================

    let draggedTab = null;
    let draggedFilterId = null;

    function getAllFilters() {
        return userFilters;
    }

    function renderFilterTabs() {
        const row = document.getElementById('sort-filters-row');
        if (!row) return;
        row.innerHTML = '';

        const filters = getAllFilters();
        for (const f of filters) {
            const tab = document.createElement('div');
            tab.className = 'sort-filter-tab' + (f.id === currentFilterId ? ' active' : '');
            tab.dataset.filterId = f.id;

            // Drag & drop dla wszystkich filtrów (włącznie z "Wszystko")
            tab.draggable = true;
            console.log('[Sortownik] Created tab for filter:', f.id, f.name, 'draggable:', tab.draggable);

            tab.addEventListener('dragstart', (e) => {
                console.log('[Sortownik] DRAGSTART - filterId:', f.id, 'name:', f.name);
                draggedTab = tab;
                draggedFilterId = f.id;
                tab.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
            });

            tab.addEventListener('dragend', (e) => {
                console.log('[Sortownik] DRAGEND - filterId:', f.id);
                tab.style.opacity = '';
                draggedTab = null;
                draggedFilterId = null;
            });

            tab.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                console.log('[Sortownik] DRAGOVER - currentTab:', f.id, 'draggedFilterId:', draggedFilterId);
                if (draggedTab && draggedTab !== tab) {
                    const tabRect = tab.getBoundingClientRect();
                    const midpoint = tabRect.left + tabRect.width / 2;
                    if (e.clientX < midpoint) {
                        tab.style.borderLeft = '2px solid #7ab4ff';
                        tab.style.borderRight = '';
                    } else {
                        tab.style.borderRight = '2px solid #7ab4ff';
                        tab.style.borderLeft = '';
                    }
                }
            });

            tab.addEventListener('dragleave', (e) => {
                tab.style.borderLeft = '';
                tab.style.borderRight = '';
            });

            tab.addEventListener('drop', (e) => {
                console.log('[Sortownik] DROP EVENT - targetId:', f.id, 'draggedFilterId:', draggedFilterId);
                e.preventDefault();
                tab.style.borderLeft = '';
                tab.style.borderRight = '';

                if (draggedFilterId === null || draggedFilterId === undefined || draggedFilterId === f.id) {
                    console.log('[Sortownik] DROP CANCELLED - same filter or no draggedFilterId');
                    return;
                }

                console.log('[Sortownik] DROP - draggedFilterId:', draggedFilterId, 'targetId:', f.id);
                console.log('[Sortownik] userFilters before:', userFilters.map(ff => ({ id: ff.id, name: ff.name })));

                // Znajdź indeksy w userFilters
                const draggedIndex = userFilters.findIndex(filter => filter.id === draggedFilterId);
                const targetIndex = userFilters.findIndex(filter => filter.id === f.id);

                console.log('[Sortownik] draggedIndex:', draggedIndex, 'targetIndex:', targetIndex);

                if (draggedIndex === -1 || targetIndex === -1) {
                    console.log('[Sortownik] BŁĄD: Nie znaleziono indeksu!');
                    return;
                }

                // Przenieś element
                const [draggedFilter] = userFilters.splice(draggedIndex, 1);

                // Wstaw w nowym miejscu (zależnie od strony taba)
                const tabRect = tab.getBoundingClientRect();
                const midpoint = tabRect.left + tabRect.width / 2;
                const newIndex = e.clientX < midpoint ? targetIndex : targetIndex + 1;

                userFilters.splice(newIndex > draggedIndex ? newIndex - 1 : newIndex, 0, draggedFilter);

                console.log('[Sortownik] userFilters after:', userFilters.map(ff => ({ id: ff.id, name: ff.name })));

                save(KEYS.filters, userFilters);
                    renderFilterTabs();
                    updateFilterCounts();
                });

            const icon = document.createElement('div');
            icon.className = 'sort-filter-icon';
            if (f.id === 0) {
                icon.classList.add('sort-icon-all');
            } else if (f.iconUrl) {
                icon.style.backgroundImage = `url('${f.iconUrl}')`;
            } else {
                icon.textContent = f.name.charAt(0).toUpperCase();
                icon.style.cssText += 'font-size:13px;display:flex;align-items:center;justify-content:center;color:#aaa;';
            }

            const amount = document.createElement('span');
            amount.className = 'sort-amount';
            // Policz itemy
            const count = countFilteredItems(f);
            amount.textContent = count > 0 ? String(count) : '';

            tab.appendChild(icon);
            tab.appendChild(amount);

            tab.addEventListener('click', () => {
                currentFilterId = f.id;
                save(KEYS.active, currentFilterId);
                renderFilterTabs();
                refreshItems();
            });

            // Prawy klik — context menu (dla wszystkich filtrów)
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                showCtxMenu(f, e.clientX, e.clientY);
            });

            // Tooltip z nazwą filtra (tylko nazwa, bez wyrażenia)
            addTip(tab, f.name);

            row.appendChild(tab);
        }

        // Apply scale settings after all tabs are created
        updateFilterScale();
    }

    function countFilteredItems(filter) {
        try {
            const items = Engine.items.fetchLocationItems('g');
            return items.filter(item => {
                // Wyklucz przedmioty założone (st > 0 oznacza że przedmiot jest założony)
                if (item.st && item.st > 0) return false;

                if (!matchesFilter(filter, item)) return false;

                // Uwzględnij wyszukiwarkę
                if (searchValue) {
                    const name  = (item.name || '').toLowerCase();
                    const stats = parseItemStats(item);
                    const opis  = (stats.opis || '').toLowerCase();
                    const customTeleport = (stats.custom_teleport || '').toLowerCase();
                    const teleport = (stats.teleport || '').toLowerCase();
                    const etiquette = (stats.etiquette || '').toLowerCase();

                    // Proste wyszukiwanie po nazwie i opisach
                    if (!name.includes(searchValue) &&
                        !opis.includes(searchValue) &&
                        !customTeleport.includes(searchValue) &&
                        !teleport.includes(searchValue) &&
                        !etiquette.includes(searchValue)) {
                        return false;
                    }
                }

                return true;
            }).length;
        } catch(e) { return 0; }
    }

    // ==================== ITEM LIST ====================

    function getFilteredItems() {
        try {
            const items = Engine.items.fetchLocationItems('g');
            const filter = getAllFilters().find(f => f.id === currentFilterId) || getAllFilters()[0];
            const filtered = items.filter(item => {
                // Wyklucz przedmioty założone (st > 0 oznacza że przedmiot jest założony)
                if (item.st && item.st > 0) return false;

                if (!matchesFilter(filter, item)) return false;
                if (searchValue) {
                    const name  = (item.name || '').toLowerCase();
                    const stats = parseItemStats(item);
                    const opis  = (stats.opis || '').toLowerCase();
                    const customTeleport = (stats.custom_teleport || '').toLowerCase();
                    const teleport = (stats.teleport || '').toLowerCase();
                    const etiquette = (stats.etiquette || '').toLowerCase();

                    // Proste wyszukiwanie po nazwie i opisach
                    if (!name.includes(searchValue) &&
                        !opis.includes(searchValue) &&
                        !customTeleport.includes(searchValue) &&
                        !teleport.includes(searchValue) &&
                        !etiquette.includes(searchValue)) {
                        return false;
                    }
                }
                return true;
            });

            if (settings.sortMode === 'newest') {

                filtered.reverse();
            } else if (settings.sortMode === 'name') {

                filtered.sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });
            } else if (settings.sortMode === 'rarity-asc' || settings.sortMode === 'rarity-desc') {

                const rarityOrder = {
                    'common': 0,
                    'unique': 1,
                    'heroic': 2,
                    'upgraded': 3,
                    'legendary': 4,
                    'artefact': 5
                };

                filtered.sort((a, b) => {
                    const rarityA = getRarity(a);
                    const rarityB = getRarity(b);
                    const orderA = rarityOrder[rarityA] !== undefined ? rarityOrder[rarityA] : -1;
                    const orderB = rarityOrder[rarityB] !== undefined ? rarityOrder[rarityB] : -1;

                    if (settings.sortMode === 'rarity-asc') {
                        return orderA - orderB;
                    } else {
                        return orderB - orderA;
                    }
                });
            }

            return filtered;
        } catch(e) { return []; }
    }

    function refreshItems() {
        const list = document.getElementById('sort-item-list');
        if (!list) return;

        const items = getFilteredItems();

        while (list.children.length > items.length) {
            list.removeChild(list.lastChild);
        }

        if (items.length === 0) {
            const currentFilter = getAllFilters().find(f => f.id === currentFilterId);
            const isUlubione = currentFilter && currentFilter.id === 9;

            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'sort-no-items-message'; // Inna klasa, nie sort-empty-message
            if (isUlubione) {
                emptyMsg.textContent = 'Kliknij na przedmiot PPM i "Dodaj do kategorii" aby dodać przedmiot do kategorii';
            } else {
                emptyMsg.textContent = '----';
            }
            list.appendChild(emptyMsg);
        } else {
            items.forEach((item, idx) => {
                const slot = list.children[idx];
                const idStr = String(item.id);

                if (slot && slot._slotId === idStr) {
                    const iconEl = slot.querySelector('.item');
                    if (iconEl) {
                        const amountEl = iconEl.querySelector('.amount');
                        if (amountEl) {
                            updateItemAmount(amountEl, item);
                        }
                    }
                    return;
                }

                const newSlot = createItemSlot(item);
                if (slot) {
                    list.replaceChild(newSlot, slot);
                } else {
                    list.appendChild(newSlot);
                }
            });
        }

        updateFilterCounts();

        updateBagSlotsDisplay();

        // Nie wywołuj restartWithActiveDisableKinds() bo restartuje WSZYSTKIE blokady
        // (np. SHOP blokuje przedmiot, a następnie restartuje to w ENHANCE, co blokuje ten sam przedmiot)
        // Zamiast tego, ikony disable są zarządzane przez Margonem automatycznie

        // Odśwież scrollbar Margonem
        try {
            const sw = list.closest('.sort-scroll-wrapper') || list.closest('.scroll-wrapper');
            if (sw && sw._updateScrollBar) {
                sw._updateScrollBar();
            } else if (sw) {
                $(sw).trigger('update');
            }
        } catch(e) {}
    }

    function updateFilterCounts() {
        const row = document.getElementById('sort-filters-row');
        if (!row) return;
        const tabs = row.querySelectorAll('.sort-filter-tab');
        const filters = getAllFilters();
        tabs.forEach((tab, i) => {
            if (i < filters.length) {
                const amount = tab.querySelector('.sort-amount');
                if (amount) {
                    const count = countFilteredItems(filters[i]);
                    amount.textContent = count > 0 ? String(count) : '';
                }
            }
        });
    }

    // ==================== CONTEXT MENU ====================

    function showCtxMenu(filter, x, y) {
        closeCtxMenu();
        const menu = document.createElement('div');
        menu.className = 'sort-ctx-menu';
        menu.id = 'sort-ctx-menu';
        menu.style.left = x + 'px';
        menu.style.top  = y + 'px';

        // Opcja edycji dla wszystkich kategorii
        const editItem = document.createElement('div');
        editItem.className = 'sort-ctx-item';
        editItem.textContent = 'Edytuj';
        editItem.addEventListener('click', () => { closeCtxMenu(); showFilterModal(filter); });
        menu.appendChild(editItem);

        // Opcja usuwania dla wszystkich kategorii
        const delItem = document.createElement('div');
        delItem.className = 'sort-ctx-item sort-ctx-danger';
        delItem.textContent = 'Usuń';
        delItem.addEventListener('click', () => {
            closeCtxMenu();

            // Zapisz usunięty filtr do historii
            const deletedFilter = {
                ...filter,
                deletedAt: Date.now()
            };
            deletedFilters.push(deletedFilter);
            save(KEYS.deletedFilters, deletedFilters);

            // Usuń z aktywnych filtrów
            userFilters = userFilters.filter(f => f.id !== filter.id);
            save(KEYS.filters, userFilters);
            if (currentFilterId === filter.id) {
                currentFilterId = 0;
                save(KEYS.active, 0);
            }
            renderFilterTabs();
            refreshItems();

            message(`Usunięto filtr "${filter.name}". Możesz go przywrócić w ustawieniach.`);
        });
        menu.appendChild(delItem);
        document.body.appendChild(menu);

        setTimeout(() => {
            document.addEventListener('click', closeCtxMenu, { once: true });
        }, 0);
    }

    function closeCtxMenu() {
        const m = document.getElementById('sort-ctx-menu');
        if (m) m.remove();
    }

    // ==================== SETTINGS MODAL ====================

    function showSettingsModal() {
        closeSettingsModal();

        const overlay = document.createElement('div');
        overlay.className = 'sort-modal-overlay';
        overlay.id = 'sort-settings-overlay';

        const modal = document.createElement('div');
        modal.className = 'sort-modal sort-settings-modal';

        modal.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

        const h3 = document.createElement('h3');
        h3.textContent = 'Ustawienia';
        modal.appendChild(h3);

        const clickRow = document.createElement('div');
        clickRow.className = 'sort-settings-row';

        const clickLabel = document.createElement('div');
        clickLabel.className = 'sort-settings-label';
        clickLabel.textContent = 'Użycie przedmiotu:';

        const clickSelect = document.createElement('select');
        clickSelect.className = 'sort-settings-select';

        const singleOption = document.createElement('option');
        singleOption.value = 'single';
        singleOption.textContent = 'Pojedyncze kliknięcie';

        const doubleOption = document.createElement('option');
        doubleOption.value = 'double';
        doubleOption.textContent = 'Podwójne kliknięcie';

        clickSelect.appendChild(singleOption);
        clickSelect.appendChild(doubleOption);
        clickSelect.value = settings.itemClickMode;

        clickSelect.addEventListener('change', () => {
            settings.itemClickMode = clickSelect.value;
            save(KEYS.settings, settings);
        });

        clickRow.appendChild(clickLabel);
        clickRow.appendChild(clickSelect);
        modal.appendChild(clickRow);

        // Ilość wierszy filtrów
        const filterRowsRow = document.createElement('div');
        filterRowsRow.className = 'sort-settings-row';

        const filterRowsLabel = document.createElement('div');
        filterRowsLabel.className = 'sort-settings-label';
        filterRowsLabel.textContent = 'Wiersze filtrów:';

        const filterRowsSelect = document.createElement('select');
        filterRowsSelect.className = 'sort-settings-select';

        const oneRowOption = document.createElement('option');
        oneRowOption.value = '1';
        oneRowOption.textContent = '1 wiersz';

        const twoRowsOption = document.createElement('option');
        twoRowsOption.value = '2';
        twoRowsOption.textContent = '2 wiersze';

        filterRowsSelect.appendChild(oneRowOption);
        filterRowsSelect.appendChild(twoRowsOption);
        filterRowsSelect.value = settings.filterRows || 1;

        filterRowsSelect.addEventListener('change', () => {
            settings.filterRows = parseInt(filterRowsSelect.value);
            save(KEYS.settings, settings);
            updateFilterRows();
        });

        filterRowsRow.appendChild(filterRowsLabel);
        filterRowsRow.appendChild(filterRowsSelect);
        modal.appendChild(filterRowsRow);

        // Rozmiar filtrów
        const filterScaleRow = document.createElement('div');
        filterScaleRow.className = 'sort-settings-row';

        const filterScaleLabel = document.createElement('div');
        filterScaleLabel.className = 'sort-settings-label';
        filterScaleLabel.textContent = 'Rozmiar filtrów:';

        const filterScaleSelect = document.createElement('select');
        filterScaleSelect.className = 'sort-settings-select';

        const scale50Option = document.createElement('option');
        scale50Option.value = '50';
        scale50Option.textContent = '50%';

        const scale75Option = document.createElement('option');
        scale75Option.value = '75';
        scale75Option.textContent = '75%';

        const scale100Option = document.createElement('option');
        scale100Option.value = '100';
        scale100Option.textContent = '100%';

        filterScaleSelect.appendChild(scale50Option);
        filterScaleSelect.appendChild(scale75Option);
        filterScaleSelect.appendChild(scale100Option);
        filterScaleSelect.value = settings.filterScale || 100;

        filterScaleSelect.addEventListener('change', () => {
            settings.filterScale = parseInt(filterScaleSelect.value);
            save(KEYS.settings, settings);
            updateFilterScale();
        });

        filterScaleRow.appendChild(filterScaleLabel);
        filterScaleRow.appendChild(filterScaleSelect);
        modal.appendChild(filterScaleRow);

        // Pozycja paska filtrów
        const positionRow = document.createElement('div');
        positionRow.className = 'sort-settings-row';

        const positionLabel = document.createElement('div');
        positionLabel.className = 'sort-settings-label';
        positionLabel.textContent = 'Pozycja paska filtrów:';

        const positionSelect = document.createElement('select');
        positionSelect.className = 'sort-settings-select';

        const leftOption = document.createElement('option');
        leftOption.value = 'left';
        leftOption.textContent = 'Lewa strona';

        const rightOption = document.createElement('option');
        rightOption.value = 'right';
        rightOption.textContent = 'Prawa strona';

        const topOption = document.createElement('option');
        topOption.value = 'top';
        topOption.textContent = 'Góra';

        const bottomOption = document.createElement('option');
        bottomOption.value = 'bottom';
        bottomOption.textContent = 'Dół';

        positionSelect.appendChild(leftOption);
        positionSelect.appendChild(rightOption);
        positionSelect.appendChild(topOption);
        positionSelect.appendChild(bottomOption);
        positionSelect.value = settings.filtersPosition;

        positionSelect.addEventListener('change', () => {
            settings.filtersPosition = positionSelect.value;
            save(KEYS.settings, settings);

            // Przebuduj panel w tle (bez zamykania modala)
            const wasVisible = isVisible;
            const currentPos = panelEl ? {
                x: parseInt(panelEl.style.left) || 200,
                y: parseInt(panelEl.style.top) || 100
            } : load(KEYS.pos, { x: 200, y: 100 });

            // Usuń stary panel
            if (panelEl) {
                panelEl.remove();
                panelEl = null;
            }

            // Stwórz nowy panel
            createPanel();

            // Przywróć pozycję
            panelEl.style.left = currentPos.x + 'px';
            panelEl.style.top = currentPos.y + 'px';

            // Przywróć widoczność
            if (wasVisible) {
                showPanel();
            }

            // Odśwież zakładki filtrów i listę itemów
            renderFilterTabs();
            refreshItems();
            updateFilterCounts();
            updateFiltersVisibility();

            // Modal pozostaje otwarty - nie robimy closeSettingsModal()
        });

        positionRow.appendChild(positionLabel);
        positionRow.appendChild(positionSelect);
        modal.appendChild(positionRow);

        const sortRow = document.createElement('div');
        sortRow.className = 'sort-settings-row';

        const sortLabel = document.createElement('div');
        sortLabel.className = 'sort-settings-label';
        sortLabel.textContent = 'Sortowanie:';

        const sortSelect = document.createElement('select');
        sortSelect.className = 'sort-settings-select';

        const newestOption = document.createElement('option');
        newestOption.value = 'newest';
        newestOption.textContent = 'Najnowsze (ID)';

        const oldestOption = document.createElement('option');
        oldestOption.value = 'oldest';
        oldestOption.textContent = 'Najstarsze (ID)';

        const nameOption = document.createElement('option');
        nameOption.value = 'name';
        nameOption.textContent = 'Po nazwie';

        const rarityAscOption = document.createElement('option');
        rarityAscOption.value = 'rarity-asc';
        rarityAscOption.textContent = 'Rzadkość (rosnąco)';

        const rarityDescOption = document.createElement('option');
        rarityDescOption.value = 'rarity-desc';
        rarityDescOption.textContent = 'Rzadkość (malejąco)';

        sortSelect.appendChild(newestOption);
        sortSelect.appendChild(oldestOption);
        sortSelect.appendChild(nameOption);
        sortSelect.appendChild(rarityAscOption);
        sortSelect.appendChild(rarityDescOption);
        sortSelect.value = settings.sortMode;

        sortSelect.addEventListener('change', () => {
            settings.sortMode = sortSelect.value;
            save(KEYS.settings, settings);
            refreshItems();
        });

        sortRow.appendChild(sortLabel);
        sortRow.appendChild(sortSelect);
        modal.appendChild(sortRow);

        const bagsRow = document.createElement('div');
        bagsRow.className = 'sort-settings-row';

        const bagsLabel = document.createElement('div');
        bagsLabel.className = 'sort-settings-label';
        bagsLabel.textContent = 'Ukryj torby z gry:';

        const bagsCheckbox = document.createElement('input');
        bagsCheckbox.type = 'checkbox';
        bagsCheckbox.className = 'sort-settings-checkbox';
        bagsCheckbox.checked = settings.hideGameBags;

        bagsCheckbox.addEventListener('change', () => {
            settings.hideGameBags = bagsCheckbox.checked;
            save(KEYS.settings, settings);
            updateGameBagsVisibility();
        });

        bagsRow.appendChild(bagsLabel);
        bagsRow.appendChild(bagsCheckbox);
        modal.appendChild(bagsRow);

        // Sekcja usuniętych filtrów
        if (deletedFilters.length > 0) {
            const deletedHeader = document.createElement('h4');
            deletedHeader.textContent = 'Usunięte filtry';
            deletedHeader.style.cssText = 'margin-top: 20px; margin-bottom: 10px; font-size: 14px; color: #fff;';
            modal.appendChild(deletedHeader);

            const deletedList = document.createElement('div');
            deletedList.className = 'sort-deleted-filters-list';
            deletedList.style.cssText = 'max-height: 150px; overflow-y: auto; margin-bottom: 15px;';

            // Sortuj od najnowszych
            const sortedDeleted = [...deletedFilters].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

            for (const deletedFilter of sortedDeleted) {
                const filterRow = document.createElement('div');
                filterRow.className = 'sort-deleted-filter-row';
                filterRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: rgba(0,0,0,0.3); margin-bottom: 5px; border-radius: 4px;';

                const filterInfo = document.createElement('div');
                filterInfo.style.cssText = 'flex: 1; overflow: hidden;';

                const filterName = document.createElement('div');
                filterName.textContent = deletedFilter.name;
                filterName.style.cssText = 'color: #fff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

                const filterExpr = document.createElement('div');
                filterExpr.textContent = deletedFilter.expression || '(brak wyrażenia)';
                filterExpr.style.cssText = 'color: #aaa; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

                filterInfo.appendChild(filterName);
                filterInfo.appendChild(filterExpr);

                const buttonsDiv = document.createElement('div');
                buttonsDiv.style.cssText = 'display: flex; gap: 5px; margin-left: 10px;';

                const restoreBtn = document.createElement('button');
                restoreBtn.textContent = 'Przywróć';
                restoreBtn.className = 'sort-restore-btn';
                restoreBtn.style.cssText = 'padding: 4px 8px; background: #4a9eff; color: #fff; border: none; border-radius: 3px; font-size: 11px;';
                restoreBtn.addEventListener('click', () => {
                    // Przywróć filtr
                    const restoredFilter = { ...deletedFilter };
                    delete restoredFilter.deletedAt;
                    userFilters.push(restoredFilter);
                    save(KEYS.filters, userFilters);

                    // Usuń z listy usuniętych
                    deletedFilters = deletedFilters.filter(f => f.id !== deletedFilter.id);
                    save(KEYS.deletedFilters, deletedFilters);

                    // Odśwież UI
                    renderFilterTabs();
                    closeSettingsModal();
                    showSettingsModal(); // Odśwież modal
                    message(`Przywrócono filtr "${deletedFilter.name}"`);
                });

                const permanentDeleteBtn = document.createElement('button');
                permanentDeleteBtn.textContent = '×';
                permanentDeleteBtn.className = 'sort-permanent-delete-btn';
                permanentDeleteBtn.style.cssText = 'padding: 4px 8px; background: #d9534f; color: #fff; border: none; border-radius: 3px; font-size: 14px; font-weight: bold;';
                permanentDeleteBtn.addEventListener('click', () => {
                    if (confirm(`Czy na pewno chcesz trwale usunąć filtr "${deletedFilter.name}"?`)) {
                        deletedFilters = deletedFilters.filter(f => f.id !== deletedFilter.id);
                        save(KEYS.deletedFilters, deletedFilters);
                        closeSettingsModal();
                        showSettingsModal(); // Odśwież modal
                        message(`Trwale usunięto filtr "${deletedFilter.name}"`);
                    }
                });

                buttonsDiv.appendChild(restoreBtn);
                buttonsDiv.appendChild(permanentDeleteBtn);

                filterRow.appendChild(filterInfo);
                filterRow.appendChild(buttonsDiv);

                deletedList.appendChild(filterRow);
            }

            modal.appendChild(deletedList);
            initCustomScrollBar(deletedList);

            // Przycisk wyczyść wszystkie
            const clearAllBtn = document.createElement('button');
            clearAllBtn.textContent = 'Wyczyść wszystkie usunięte filtry';
            clearAllBtn.style.cssText = 'width: 100%; padding: 8px; background: #d9534f; color: #fff; border: none; border-radius: 4px; margin-bottom: 15px;';
            clearAllBtn.addEventListener('click', () => {
                if (confirm('Czy na pewno chcesz trwale usunąć wszystkie usunięte filtry?')) {
                    deletedFilters = [];
                    save(KEYS.deletedFilters, deletedFilters);
                    closeSettingsModal();
                    showSettingsModal(); // Odśwież modal
                    message('Wyczyszczono wszystkie usunięte filtry');
                }
            });
            modal.appendChild(clearAllBtn);
        }

        const btnsDiv = document.createElement('div');
        btnsDiv.className = 'sort-modal-btns';

        const closeBtn = document.createElement('div');
        closeBtn.className = 'sort-modal-btn sort-btn-primary';
        closeBtn.textContent = 'Zamknij';
        closeBtn.addEventListener('click', closeSettingsModal);

        btnsDiv.appendChild(closeBtn);
        modal.appendChild(btnsDiv);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        initCustomScrollBar(modal);
    }

    function closeSettingsModal() {
        const m = document.getElementById('sort-settings-overlay');
        if (m) m.remove();
    }

    // ==================== GAME BAGS VISIBILITY ====================

    function updateGameBagsVisibility() {

        const styleId = 'sortownik-hide-game-bags-style';
        let style = document.getElementById(styleId);

        if (settings.hideGameBags) {
            if (!style) {
                style = document.createElement('style');
                style.id = styleId;
                style.textContent = `
                    /* Ukryj przedmioty w ekwipunku */
                    .game-window-positioner .inventory_wrapper .inventory-grid .inner-grid .scroll-pane .item,
                    .bottomItem {
                        display: none !important;
                    }
                    /* Ukryj nawigację toreb (sloty na torby) */
                    .game-window-positioner .inventory_wrapper .bags-navigation-bg {
                        display: none !important;
                    }
                    /* Ukryj siatkę ekwipunku (tło z kratkami) */
                    .game-window-positioner .inventory_wrapper .inventory-grid-bg {
                        display: none !important;
                    }
                `;
                document.head.appendChild(style);
            }
        } else {
            if (style) {
                style.remove();
            }
        }
    }

    // ==================== FILTER MODAL ====================

    function showFilterModal(editFilter = null) {
        closeFilterModal();

        const overlay = document.createElement('div');
        overlay.className = 'sort-modal-overlay';
        overlay.id = 'sort-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'sort-modal';

        modal.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

        // Dodaj możliwość przeciągania okna
        let isModalDragging = false;
        let modalDragOffset = { x: 0, y: 0 };

        const modalHeader = document.createElement('div');
        modalHeader.className = 'sort-modal-header';
        modalHeader.style.cssText = 'padding:8px;margin:-12px -12px 12px -12px;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(255,255,255,0.1);';

        modalHeader.addEventListener('mousedown', (e) => {
            isModalDragging = true;
            const rect = modal.getBoundingClientRect();
            modalDragOffset.x = e.clientX - rect.left;
            modalDragOffset.y = e.clientY - rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (isModalDragging) {
                const newLeft = e.clientX - modalDragOffset.x;
                const newTop = e.clientY - modalDragOffset.y;
                modal.style.left = newLeft + 'px';
                modal.style.top = newTop + 'px';
                modal.style.transform = 'none';
            }
        });

        document.addEventListener('mouseup', () => {
            isModalDragging = false;
        });

        const h3 = document.createElement('h3');
        h3.textContent = editFilter ? 'Edytuj filtr' : 'Nowy filtr';
        h3.style.cssText = 'margin:0;';
        modalHeader.appendChild(h3);
        modal.appendChild(modalHeader);

        const lblName = document.createElement('label');
        lblName.textContent = 'Nazwa filtra';
        modal.appendChild(lblName);
        const inpName = document.createElement('input');
        inpName.type = 'text';
        inpName.value = editFilter ? editFilter.name : '';
        inpName.placeholder = 'np. Związane legendy';
        modal.appendChild(inpName);

        const lblExpr = document.createElement('label');
        lblExpr.textContent = 'Wyrażenie filtra';
        modal.appendChild(lblExpr);
        const inpExpr = document.createElement('input');
        inpExpr.type = 'text';
        inpExpr.id = 'sort-modal-expr';
        inpExpr.value = editFilter ? editFilter.expression : '';
        inpExpr.placeholder = 'np. rarity=legendary&(soulbound|permbound)';

        // Zablokuj pole wyrażenia dla filtrów "Wszystko" (id=0) i "Ulubione" (id=9)
        const isSpecialFilter = editFilter && (editFilter.id === 0 || editFilter.id === 9);
        const isWszystkoFilter = editFilter && editFilter.id === 0;
        const isUlubioneFilter = editFilter && editFilter.id === 9;

        if (isSpecialFilter) {
            inpExpr.disabled = true;
            inpExpr.style.opacity = '0.5';
            inpExpr.style.cursor = 'not-allowed';
            lblExpr.style.opacity = '0.6';

            if (isWszystkoFilter) {
                inpExpr.placeholder = 'Kategoria "Wszystko" pokazuje wszystkie przedmioty';
            } else {
                inpExpr.placeholder = 'Filtr "Ulubione" działa tylko na podstawie nazw przedmiotów';
            }
        }

        // Dodaj element podglądu przedmiotów
        const previewDiv = document.createElement('div');
        previewDiv.className = 'sort-filter-preview';
        previewDiv.id = 'sort-filter-preview';
        previewDiv.style.cssText = 'max-height:200px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:6px;background:rgba(0,0,0,0.3);margin-top:6px;margin-bottom:8px;min-height:40px;display:flex;flex-wrap:wrap;gap:2px;align-content:flex-start;';

        const previewLabel = document.createElement('div');
        previewLabel.style.cssText = 'font-size:10px;color:#888;margin-bottom:4px;width:100%;';
        previewLabel.textContent = 'Podgląd pasujących przedmiotów:';

        // Pobierz przedmioty JEDNORAZOWO na starcie
        let cachedItems = null;
        try {
            cachedItems = Engine.items.fetchLocationItems('g').filter(item => {
                // Wyklucz przedmioty założone
                return !(item.st && item.st > 0);
            });
        } catch(e) {
            console.error('[Sortownik] Error fetching items for preview:', e);
            cachedItems = [];
        }
        // Funkcja aktualizująca podgląd
        let previewTimeout = null;
        function updateLivePreview() {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(() => {
                const expr = inpExpr.value.trim();

                // Wyczyść tylko zawartość podglądu, zachowaj label
                while (previewDiv.children.length > 1) {
                    previewDiv.removeChild(previewDiv.lastChild);
                }

                try {
                    // Stwórz tymczasowy filtr do testowania
                    const testFilter = {
                        id: -1,
                        name: 'test',
                        expression: expr,
                        itemNames: [],
                        itemIds: [],
                        excludedNames: [],
                        excludedIds: []
                    };

                    // Tylko FILTRUJ już pobrane przedmioty (nie pobieraj ponownie!)
                    const matchingItems = cachedItems.filter(item => matchesFilter(testFilter, item));

                    if (matchingItems.length === 0) {
                        const emptyMsg = document.createElement('div');
                        emptyMsg.style.cssText = 'color:#666;font-size:10px;text-align:center;padding:12px;width:100%;';
                        emptyMsg.textContent = expr ? 'Brak pasujących przedmiotów' : 'Wpisz wyrażenie aby zobaczyć podgląd';
                        previewDiv.appendChild(emptyMsg);
                    } else {
                        const count = document.createElement('div');
                        count.style.cssText = 'font-size:10px;color:#888;margin-bottom:4px;width:100%;';
                        count.textContent = `Znaleziono: ${matchingItems.length} przedmiotów`;
                        previewDiv.appendChild(count);

                        // Pokaż wszystkie przedmioty używając createItemSlot
                        matchingItems.forEach(item => {
                            try {
                                const itemSlot = createItemSlot(item);
                                itemSlot.style.cssText = 'margin:0;'; // Usuń domyślny margines
                                previewDiv.appendChild(itemSlot);
                            } catch(e) {
                                console.error('[Sortownik] Error creating preview item:', e);
                            }
                        });
                    }
                } catch(e) {
                    const errorMsg = document.createElement('div');
                    errorMsg.style.cssText = 'color:#c44;font-size:10px;padding:4px;width:100%;';
                    errorMsg.textContent = 'Błąd w wyrażeniu: ' + e.message;
                    previewDiv.appendChild(errorMsg);
                }
                if (previewDiv._updateScrollBar) previewDiv._updateScrollBar();
            }, 300); // Debounce 300ms
        }

        // Dodaj label jako pierwsze dziecko
        previewDiv.appendChild(previewLabel);

        // Aktualizuj podgląd przy każdej zmianie
        inpExpr.addEventListener('input', updateLivePreview);

        // Funkcja generująca tooltip z tłumaczeniami dla wyrażenia
        function updateExpressionTooltip() {
            const expr = inpExpr.value.trim();
            if (!expr) {
                addTip(inpExpr, 'Wpisz wyrażenie filtra używając operatorów: & (AND), | (OR), ! (NOT), = (równe), ~ (zawiera), > (więcej), < (mniej), () (grupowanie)<br>Przykład: rarity=legendary&(soulbound|permbound)');
                return;
            }

            // Pobierz listę znanych kluczy statystyk
            const statsMap = scanStats();
            const knownKeys = new Set(statsMap.keys());

            // Dodaj klucze z już znalezionych tłumaczeń
            for (const key of Object.keys(translationResults.success)) {
                knownKeys.add(key);
            }

            // Dodaj ręczne tłumaczenia
            for (const key of Object.keys(MANUAL_TRANSLATIONS)) {
                knownKeys.add(key);
            }

            // Wyciągnij wszystkie klucze z wyrażenia (przed operatorami =, ~, >, <)
            const keyPattern = /!?([a-zA-Z_][a-zA-Z0-9_]*(?:=[a-zA-Z0-9_]+)?)/g;
            const matches = [...expr.matchAll(keyPattern)];
            const uniqueKeys = new Set();

            for (const match of matches) {
                let key = match[1];
                // Jeśli to action=wartość, zachowaj całość
                if (key.startsWith('action=')) {
                    // Sprawdź czy taki klucz istnieje w znanych kluczach
                    if (knownKeys.has(key)) {
                        uniqueKeys.add(key);
                    }
                } else {
                    // W przeciwnym razie usuń wartość jeśli jest
                    const baseKey = key.split(/[=~><]/)[0];
                    // Dodaj tylko jeśli to znany klucz statystyki
                    if (knownKeys.has(baseKey)) {
                        uniqueKeys.add(baseKey);
                    }
                }
            }

            if (uniqueKeys.size === 0) {
                addTip(inpExpr, 'Wpisz wyrażenie filtra używając operatorów: & (AND), | (OR), ! (NOT), = (równe), ~ (zawiera), > (więcej), < (mniej), () (grupowanie)<br>Przykład: rarity=legendary&(soulbound|permbound)');
                return;
            }

            // Stwórz listę tłumaczeń
            const translations = [];
            for (const key of uniqueKeys) {
                const translation = getTranslation(key);
                if (translation) {
                    translations.push(`<b>${key}:</b> ${translation}`);
                } else {
                    translations.push(`<b>${key}:</b> (brak tłumaczenia)`);
                }
            }

            const tooltipText = 'Klucze w wyrażeniu:<br>' + translations.join('<br>');
            addTip(inpExpr, tooltipText);
        }

        // Ustaw początkowy tooltip
        updateExpressionTooltip();

        // Aktualizuj tooltip po każdej zmianie
        inpExpr.addEventListener('input', updateExpressionTooltip);
        inpExpr.addEventListener('blur', updateExpressionTooltip);

        modal.appendChild(inpExpr);
        modal.appendChild(previewDiv);
        initCustomScrollBar(previewDiv);

        // Uruchom początkowy podgląd
        updateLivePreview();

        const opsDiv = document.createElement('div');
        opsDiv.className = 'sort-ops';

        // Ukryj przyciski operatorów dla specjalnych filtrów (Wszystko, Ulubione)
        if (isSpecialFilter) {
            opsDiv.style.display = 'none';
        }

        const operatorHelp = {
            '&': 'I (AND) - łączy warunki: oba muszą być spełnione<br>Przykład: rarity=heroic&soulbound',
            '|': 'LUB (OR) - co najmniej jeden warunek<br>Przykład: name~błogo|name~skrzynia',
            '!': 'NIE (NOT) - neguje warunek<br>Przykład: !soulbound (przedmioty bez soulbound)',
            '=': 'Równe - dokładne dopasowanie<br>Przykład: rarity=legendary',
            '~': 'Zawiera - wyszukuje tekst<br>Przykład: name~miecz<br>Wiele wartości: name~[miecz,topór,łuk]',
            '>': 'Większe niż<br>Przykład: dmg>100',
            '<': 'Mniejsze niż<br>Przykład: lvl<50',
            '(': 'Grupowanie - określa kolejność operacji<br>Przykład: rarity=heroic&(soulbound|permbound)',
            ')': 'Zamyka grupę'
        };

        for (const [label, val] of [['& (AND)','&'],['| (OR)','|'],['! (NOT)','!'],['( )','()'],['= (równe)','='],['~ (zawiera)','~'],['> (więcej)','>'],['< (mniej)','<']]) {
            const btn = document.createElement('div');
            btn.className = 'sort-op-btn';
            btn.textContent = label;

            // Dodaj tooltip z wyjaśnieniem
            // Dla nawiasów użyj klucza '(' zamiast '()'
            const helpKey = val === '()' ? '(' : val;
            if (operatorHelp[helpKey]) {
                addTip(btn, operatorHelp[helpKey]);
            }

            btn.addEventListener('click', () => {
                const pos = inpExpr.selectionStart || inpExpr.value.length;

                // Specjalna obsługa dla nawiasów - wstaw oba i umieść kursor w środku
                if (val === '()') {
                    inpExpr.value = inpExpr.value.substring(0, pos) + '()' + inpExpr.value.substring(pos);
                    inpExpr.focus();
                    inpExpr.setSelectionRange(pos + 1, pos + 1); // Kursor między nawiasami
                } else {
                    inpExpr.value = inpExpr.value.substring(0, pos) + val + inpExpr.value.substring(pos);
                    inpExpr.focus();
                    inpExpr.setSelectionRange(pos + val.length, pos + val.length);
                }
            });
            opsDiv.appendChild(btn);
        }
        modal.appendChild(opsDiv);

        const statsMap = scanStats();

        const popularFields = [
            'revive', 'enhancement_add_point', 'fullheal', 'leczy', 'perheal', 'summonparty',
            'emo', 'expadd', 'expires', 'nodesc', 'artisanbon', 'soulbound',
            'enhancement_upgrade_lvl', 'custom_teleport', 'teleport', 'etiquette'
        ];

        const actionFields = [
            { key: 'action', value: 'flee', display: 'action=flee' },
            { key: 'action', value: 'nloc', display: 'action=nloc' },
            { key: 'action', value: 'mail', display: 'action=mail' },
            { key: 'action', value: 'auction', display: 'action=auction' },
            { key: 'action', value: 'shop', display: 'action=shop' },
            { key: 'action', value: 'deposit', display: 'action=deposit' },
            { key: 'action', value: 'clandeposit', display: 'action=clandeposit' },
            { key: 'action', value: 'fatigue', display: 'action=fatigue' }
        ];

        for (const field of popularFields) {
            if (!statsMap.has(field)) {
                statsMap.set(field, new Set(['?']));
            }
        }

        for (const { key, value, display } of actionFields) {
            if (!statsMap.has(display)) {
                statsMap.set(display, new Set([value]));
            }
        }

        if (statsMap.size > 0) {
            const statsLabel = document.createElement('div');
            statsLabel.className = 'sort-stats-label';
            statsLabel.textContent = 'Dostępne pola (kliknij aby dodać):';

            // Ukryj sekcję dostępnych pól dla specjalnych filtrów (Wszystko, Ulubione)
            if (isSpecialFilter) {
                statsLabel.style.display = 'none';
            }

            modal.appendChild(statsLabel);

            const searchFieldInput = document.createElement('input');
            searchFieldInput.type = 'text';
            searchFieldInput.placeholder = 'Szukaj pola... np. evade lub Unik';
            searchFieldInput.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:4px;';

            // Ukryj wyszukiwarkę pól dla specjalnych filtrów (Wszystko, Ulubione)
            if (isSpecialFilter) {
                searchFieldInput.style.display = 'none';
            }

            modal.appendChild(searchFieldInput);

            const chipsDiv = document.createElement('div');
            chipsDiv.className = 'sort-stats-chips';

            // Ukryj chipsy pól dla specjalnych filtrów (Wszystko, Ulubione)
            if (isSpecialFilter) {
                chipsDiv.style.display = 'none';
            }

            chipsDiv.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

            const directProps = ['cl','name','enhancementPoints','rarity','tpl','id','pr','ttl','wt'];
            const statKeys = [...statsMap.keys()].sort();

            const allChips = [];

            for (const key of statKeys) {
                const chip = document.createElement('div');
                chip.className = 'sort-chip' + (directProps.includes(key) ? ' sort-chip-prop' : '');
                chip.dataset.key = key.toLowerCase();

                const translation = getTranslation(key);
                chip.dataset.translation = translation ? translation.toLowerCase() : '';

                const examples = [...statsMap.get(key)];
                const exStr = examples.slice(0, 5).join(', ') + (examples.length > 5 ? '…' : '');

                let tipText;
                if (key === 'cl') {
                    // Specjalna obsługa dla cl - pokaż wszystkie możliwe wartości ze słownika gry
                    const clTranslations = [];
                    const clSearchTerms = []; // Terminy do wyszukiwania
                    for (let i = 1; i <= 32; i++) {
                        const clName = getClTranslation(i);
                        if (clName) {
                            clTranslations.push(`${i} = ${clName}`);
                            clSearchTerms.push(clName.toLowerCase());
                        }
                    }
                    // Dodaj wszystkie polskie nazwy klas do dataset.translation aby można było ich szukać
                    chip.dataset.translation = (translation ? translation.toLowerCase() + ' ' : '') + clSearchTerms.join(' ');
                    tipText = `${translation || 'Klasa przedmiotu'}<br><br>Możliwe wartości:<br>${clTranslations.join('<br>')}`;
                } else {
                    tipText = translation
                        ? `${translation}<br>Przykłady: ${exStr}`
                        : `Przykłady: ${exStr}`;
                }

                chip.textContent = key;
                addTip(chip, tipText);

                chip.addEventListener('click', () => {
                    const pos = inpExpr.selectionStart || inpExpr.value.length;
                    inpExpr.value = inpExpr.value.substring(0, pos) + key + inpExpr.value.substring(pos);
                    inpExpr.focus();
                    inpExpr.setSelectionRange(pos + key.length, pos + key.length);
                });
                chipsDiv.appendChild(chip);
                allChips.push(chip);
            }

            searchFieldInput.addEventListener('input', () => {
                const search = searchFieldInput.value.trim().toLowerCase();
                allChips.forEach(chip => {
                    const matchesKey = chip.dataset.key.includes(search);
                    const matchesTranslation = chip.dataset.translation.includes(search);
                    if (search === '' || matchesKey || matchesTranslation) {
                        chip.style.display = '';
                    } else {
                        chip.style.display = 'none';
                    }
                });
                // Przewiń do góry po wyszukiwaniu
                chipsDiv.scrollTop = 0;
            });

            modal.appendChild(chipsDiv);
            initCustomScrollBar(chipsDiv);

            logTranslationResults();
        }

        const tempItemNames = editFilter && editFilter.itemNames ? [...editFilter.itemNames] : [];
        const tempItemIds = editFilter && editFilter.itemIds
            ? editFilter.itemIds.map(e => typeof e === 'object' && e !== null ? { ...e } : { id: String(e), name: '' })
            : [];

        // Uzupełnij brakujące nazwy dla ID jeśli przedmiot znajduje się w Engine
        tempItemIds.forEach(entry => {
            if (!entry.name && typeof Engine !== 'undefined' && Engine?.items?.getItemById) {
                const it = Engine.items.getItemById(entry.id);
                if (it && it.name) {
                    entry.name = it.name;
                }
            }
        });

        const tempExcludedNames = editFilter && editFilter.excludedNames ? [...editFilter.excludedNames] : [];
        const tempExcludedIds = editFilter && editFilter.excludedIds
            ? editFilter.excludedIds.map(e => typeof e === 'object' && e !== null ? { ...e } : { id: String(e), name: '' })
            : [];

        tempExcludedIds.forEach(entry => {
            if (!entry.name && typeof Engine !== 'undefined' && Engine?.items?.getItemById) {
                const it = Engine.items.getItemById(entry.id);
                if (it && it.name) {
                    entry.name = it.name;
                }
            }
        });

        const lblItemNames = document.createElement('label');
        lblItemNames.textContent = 'Przypisane przedmioty (Nazwa / ID)';
        lblItemNames.style.marginTop = '12px';

        // Ukryj sekcję nazw przedmiotów dla "Wszystko"
        if (isWszystkoFilter) {
            lblItemNames.style.display = 'none';
        }

        modal.appendChild(lblItemNames);

        const itemNamesDesc = document.createElement('div');
        itemNamesDesc.style.cssText = 'font-size:10px;color:#888;margin-bottom:4px;';
        itemNamesDesc.textContent = 'Przedmioty z tej listy będą pokazywane wraz z przedmiotami pasującymi do wyrażenia (PPM na item → Dodaj do kategorii → wybór kategorii → Nazwa lub ID)';

        if (isWszystkoFilter) {
            itemNamesDesc.style.display = 'none';
        }

        modal.appendChild(itemNamesDesc);

        const itemNameInputWrap = document.createElement('div');
        itemNameInputWrap.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';

        if (isWszystkoFilter) {
            itemNameInputWrap.style.display = 'none';
        }

        const addModeSelect = document.createElement('select');
        addModeSelect.style.cssText = 'padding:4px 6px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.2);color:#ddd;border-radius:3px;font-size:11px;';
        const optName = document.createElement('option');
        optName.value = 'name';
        optName.textContent = 'Nazwa';
        const optId = document.createElement('option');
        optId.value = 'id';
        optId.textContent = 'ID';
        addModeSelect.appendChild(optName);
        addModeSelect.appendChild(optId);

        const itemNameInput = document.createElement('input');
        itemNameInput.type = 'text';
        itemNameInput.placeholder = 'Wpisz nazwę przedmiotu...';
        itemNameInput.style.cssText = 'flex:1;';

        addModeSelect.addEventListener('change', () => {
            itemNameInput.placeholder = addModeSelect.value === 'id' ? 'Wpisz ID przedmiotu...' : 'Wpisz nazwę przedmiotu...';
        });

        const addItemNameBtn = document.createElement('button');
        addItemNameBtn.textContent = 'Dodaj';
        addItemNameBtn.style.cssText = 'padding:4px 12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#ddd;border-radius:3px;transition:background 0.2s,border-color 0.2s;';
        addItemNameBtn.addEventListener('mouseenter', () => {
            addItemNameBtn.style.background = 'rgba(255,255,255,0.2)';
            addItemNameBtn.style.borderColor = 'rgba(255,255,255,0.3)';
        });
        addItemNameBtn.addEventListener('mouseleave', () => {
            addItemNameBtn.style.background = 'rgba(255,255,255,0.1)';
            addItemNameBtn.style.borderColor = 'rgba(255,255,255,0.2)';
        });

        const handleAddItem = () => {
            const val = itemNameInput.value.trim();
            if (!val) return;

            if (addModeSelect.value === 'id') {
                const cleanId = String(val);
                if (tempItemIds.some(e => String(e.id) === cleanId)) {
                    message('To ID już jest na liście');
                    return;
                }
                let resolvedName = '';
                if (typeof Engine !== 'undefined' && Engine?.items?.getItemById) {
                    const it = Engine.items.getItemById(cleanId);
                    if (it && it.name) resolvedName = it.name;
                }
                tempItemIds.push({ id: cleanId, name: resolvedName });
                // Jeśli było w wykluczeniach, usuń z wykluczeń
                const exclIdx = tempExcludedIds.findIndex(e => String(e.id) === cleanId);
                if (exclIdx > -1) {
                    tempExcludedIds.splice(exclIdx, 1);
                    refreshExcludedList();
                }
                refreshItemNamesList();
                itemNameInput.value = '';
            } else {
                if (tempItemNames.some(n => n.toLowerCase() === val.toLowerCase())) {
                    message('Ta nazwa już jest na liście');
                    return;
                }
                tempItemNames.push(val);
                // Jeśli było w wykluczeniach, usuń z wykluczeń
                const exclIdx = tempExcludedNames.findIndex(n => n.toLowerCase() === val.toLowerCase());
                if (exclIdx > -1) {
                    tempExcludedNames.splice(exclIdx, 1);
                    refreshExcludedList();
                }
                refreshItemNamesList();
                itemNameInput.value = '';
            }
        };

        addItemNameBtn.addEventListener('click', handleAddItem);
        itemNameInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                handleAddItem();
            }
        });

        itemNameInputWrap.appendChild(addModeSelect);
        itemNameInputWrap.appendChild(itemNameInput);
        itemNameInputWrap.appendChild(addItemNameBtn);
        modal.appendChild(itemNameInputWrap);

        const itemNamesListDiv = document.createElement('div');
        itemNamesListDiv.id = 'sort-item-names-list';
        itemNamesListDiv.className = 'sort-item-names-list';
        itemNamesListDiv.style.cssText = 'max-height:120px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:4px;background:rgba(0,0,0,0.3);';

        if (isWszystkoFilter) {
            itemNamesListDiv.style.display = 'none';
        }

        modal.appendChild(itemNamesListDiv);
        initCustomScrollBar(itemNamesListDiv);

        function refreshItemNamesList() {
            itemNamesListDiv.innerHTML = '';
            const totalCount = tempItemNames.length + tempItemIds.length;
            if (totalCount === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color:#666;font-size:10px;text-align:center;padding:8px;';
                empty.textContent = 'Brak przypisanych przedmiotów (filtr działa tylko na podstawie wyrażenia)';
                itemNamesListDiv.appendChild(empty);
                return;
            }

            // Przedmioty dodane po nazwie
            tempItemNames.forEach(name => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 6px;margin:2px 0;background:rgba(255,255,255,0.05);border-radius:3px;border-left:3px solid #27ae60;';

                const leftWrap = document.createElement('div');
                leftWrap.style.cssText = 'display:flex;align-items:center;gap:6px;overflow:hidden;flex:1;';

                const badge = document.createElement('span');
                badge.textContent = 'Nazwa';
                badge.style.cssText = 'font-size:9px;font-weight:bold;padding:1px 5px;border-radius:3px;background:rgba(39,174,96,0.25);color:#5fd68a;border:1px solid rgba(39,174,96,0.4);white-space:nowrap;flex-shrink:0;';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                nameSpan.title = name;
                nameSpan.style.cssText = 'font-size:11px;color:#eee;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;';

                leftWrap.appendChild(badge);
                leftWrap.appendChild(nameSpan);

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.title = 'Usuń';
                removeBtn.style.cssText = 'width:20px;height:20px;padding:0;background:rgba(200,60,60,0.2);border:1px solid rgba(200,60,60,0.3);color:#f99;border-radius:2px;font-size:12px;flex-shrink:0;margin-left:6px;transition:background 0.2s,border-color 0.2s;';
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.4)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.5)';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.2)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.3)';
                });
                removeBtn.addEventListener('click', () => {
                    const index = tempItemNames.indexOf(name);
                    if (index > -1) {
                        tempItemNames.splice(index, 1);
                        refreshItemNamesList();
                    }
                });

                row.appendChild(leftWrap);
                row.appendChild(removeBtn);
                itemNamesListDiv.appendChild(row);
            });

            // Przedmioty dodane po ID
            tempItemIds.forEach(entry => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 6px;margin:2px 0;background:rgba(255,255,255,0.05);border-radius:3px;border-left:3px solid #2ecc71;';

                const leftWrap = document.createElement('div');
                leftWrap.style.cssText = 'display:flex;align-items:center;gap:6px;overflow:hidden;flex:1;';

                const badge = document.createElement('span');
                badge.textContent = 'ID';
                badge.style.cssText = 'font-size:9px;font-weight:bold;padding:1px 5px;border-radius:3px;background:rgba(46,204,113,0.25);color:#6ce89d;border:1px solid rgba(46,204,113,0.4);white-space:nowrap;flex-shrink:0;';

                const contentWrap = document.createElement('div');
                contentWrap.style.cssText = 'display:flex;align-items:baseline;gap:5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';

                const nameText = entry.name || (typeof Engine !== 'undefined' && Engine?.items?.getItemById?.(entry.id)?.name) || 'Nieznany przedmiot';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = nameText;
                nameSpan.title = `${nameText} (ID: ${entry.id})`;
                nameSpan.style.cssText = 'font-size:11px;color:#eee;font-weight:500;';

                const idSpan = document.createElement('span');
                idSpan.textContent = `(ID: ${entry.id})`;
                idSpan.style.cssText = 'font-size:10px;color:#aaa;';

                contentWrap.appendChild(nameSpan);
                contentWrap.appendChild(idSpan);

                leftWrap.appendChild(badge);
                leftWrap.appendChild(contentWrap);

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.title = 'Usuń';
                removeBtn.style.cssText = 'width:20px;height:20px;padding:0;background:rgba(200,60,60,0.2);border:1px solid rgba(200,60,60,0.3);color:#f99;border-radius:2px;font-size:12px;flex-shrink:0;margin-left:6px;transition:background 0.2s,border-color 0.2s;';
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.4)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.5)';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.2)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.3)';
                });
                removeBtn.addEventListener('click', () => {
                    const index = tempItemIds.indexOf(entry);
                    if (index > -1) {
                        tempItemIds.splice(index, 1);
                        refreshItemNamesList();
                    }
                });

                row.appendChild(leftWrap);
                row.appendChild(removeBtn);
                itemNamesListDiv.appendChild(row);
            });
            if (itemNamesListDiv._updateScrollBar) itemNamesListDiv._updateScrollBar();
        }

        refreshItemNamesList();

        // Sekcja wykluczonych przedmiotów (np. usuniętych z wyrażenia)
        const lblExcluded = document.createElement('label');
        lblExcluded.textContent = 'Wykluczone przedmioty (Nazwa / ID)';
        lblExcluded.style.marginTop = '12px';

        if (isWszystkoFilter) {
            lblExcluded.style.display = 'none';
        }
        modal.appendChild(lblExcluded);

        const excludedDesc = document.createElement('div');
        excludedDesc.style.cssText = 'font-size:10px;color:#888;margin-bottom:4px;';
        excludedDesc.textContent = 'Przedmioty wykluczone z tej kategorii (nie będą pokazywane nawet jeśli pasują do wyrażenia filtra)';

        if (isWszystkoFilter) {
            excludedDesc.style.display = 'none';
        }
        modal.appendChild(excludedDesc);

        const excludedInputWrap = document.createElement('div');
        excludedInputWrap.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';

        if (isWszystkoFilter) {
            excludedInputWrap.style.display = 'none';
        }

        const exclModeSelect = document.createElement('select');
        exclModeSelect.style.cssText = 'padding:4px 6px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.2);color:#ddd;border-radius:3px;font-size:11px;';
        const optExclName = document.createElement('option');
        optExclName.value = 'name';
        optExclName.textContent = 'Nazwa';
        const optExclId = document.createElement('option');
        optExclId.value = 'id';
        optExclId.textContent = 'ID';
        exclModeSelect.appendChild(optExclName);
        exclModeSelect.appendChild(optExclId);

        const excludedInput = document.createElement('input');
        excludedInput.type = 'text';
        excludedInput.placeholder = 'Wpisz nazwę przedmiotu do wykluczenia...';
        excludedInput.style.cssText = 'flex:1;';

        exclModeSelect.addEventListener('change', () => {
            excludedInput.placeholder = exclModeSelect.value === 'id' ? 'Wpisz ID przedmiotu do wykluczenia...' : 'Wpisz nazwę przedmiotu do wykluczenia...';
        });

        const addExcludedBtn = document.createElement('button');
        addExcludedBtn.textContent = 'Dodaj';
        addExcludedBtn.style.cssText = 'padding:4px 12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#ddd;border-radius:3px;transition:background 0.2s,border-color 0.2s;';
        addExcludedBtn.addEventListener('mouseenter', () => {
            addExcludedBtn.style.background = 'rgba(255,255,255,0.2)';
            addExcludedBtn.style.borderColor = 'rgba(255,255,255,0.3)';
        });
        addExcludedBtn.addEventListener('mouseleave', () => {
            addExcludedBtn.style.background = 'rgba(255,255,255,0.1)';
            addExcludedBtn.style.borderColor = 'rgba(255,255,255,0.2)';
        });

        const handleAddExcluded = () => {
            const val = excludedInput.value.trim();
            if (!val) return;

            if (exclModeSelect.value === 'id') {
                const cleanId = String(val);
                if (tempExcludedIds.some(e => String(e.id) === cleanId)) {
                    message('To ID już jest na liście wykluczonych');
                    return;
                }
                let resolvedName = '';
                if (typeof Engine !== 'undefined' && Engine?.items?.getItemById) {
                    const it = Engine.items.getItemById(cleanId);
                    if (it && it.name) resolvedName = it.name;
                }
                tempExcludedIds.push({ id: cleanId, name: resolvedName });
                // Jeśli było w przypisanych, usuń z przypisanych
                const itemIdx = tempItemIds.findIndex(e => String(e.id) === cleanId);
                if (itemIdx > -1) {
                    tempItemIds.splice(itemIdx, 1);
                    refreshItemNamesList();
                }
                refreshExcludedList();
                excludedInput.value = '';
            } else {
                if (tempExcludedNames.some(n => n.toLowerCase() === val.toLowerCase())) {
                    message('Ta nazwa już jest na liście wykluczonych');
                    return;
                }
                tempExcludedNames.push(val);
                // Jeśli było w przypisanych, usuń z przypisanych
                const itemIdx = tempItemNames.findIndex(n => n.toLowerCase() === val.toLowerCase());
                if (itemIdx > -1) {
                    tempItemNames.splice(itemIdx, 1);
                    refreshItemNamesList();
                }
                refreshExcludedList();
                excludedInput.value = '';
            }
        };

        addExcludedBtn.addEventListener('click', handleAddExcluded);
        excludedInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                handleAddExcluded();
            }
        });

        excludedInputWrap.appendChild(exclModeSelect);
        excludedInputWrap.appendChild(excludedInput);
        excludedInputWrap.appendChild(addExcludedBtn);
        modal.appendChild(excludedInputWrap);

        const excludedListDiv = document.createElement('div');
        excludedListDiv.id = 'sort-excluded-items-list';
        excludedListDiv.className = 'sort-item-names-list';
        excludedListDiv.style.cssText = 'max-height:100px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:4px;background:rgba(0,0,0,0.3);margin-bottom:8px;';

        if (isWszystkoFilter) {
            excludedListDiv.style.display = 'none';
        }
        modal.appendChild(excludedListDiv);
        initCustomScrollBar(excludedListDiv);

        function refreshExcludedList() {
            excludedListDiv.innerHTML = '';
            const totalCount = tempExcludedNames.length + tempExcludedIds.length;
            if (totalCount === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color:#666;font-size:10px;text-align:center;padding:8px;';
                empty.textContent = 'Brak wykluczonych przedmiotów';
                excludedListDiv.appendChild(empty);
                return;
            }

            tempExcludedNames.forEach(name => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 6px;margin:2px 0;background:rgba(255,255,255,0.05);border-radius:3px;border-left:3px solid #e74c3c;';

                const leftWrap = document.createElement('div');
                leftWrap.style.cssText = 'display:flex;align-items:center;gap:6px;overflow:hidden;flex:1;';

                const badge = document.createElement('span');
                badge.textContent = 'Nazwa';
                badge.style.cssText = 'font-size:9px;font-weight:bold;padding:1px 5px;border-radius:3px;background:rgba(231,76,60,0.25);color:#e74c3c;border:1px solid rgba(231,76,60,0.4);white-space:nowrap;flex-shrink:0;';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                nameSpan.title = name;
                nameSpan.style.cssText = 'font-size:11px;color:#eee;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;';

                leftWrap.appendChild(badge);
                leftWrap.appendChild(nameSpan);

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.title = 'Usuń wykluczenie';
                removeBtn.style.cssText = 'width:20px;height:20px;padding:0;background:rgba(200,60,60,0.2);border:1px solid rgba(200,60,60,0.3);color:#f99;cursor:pointer;border-radius:2px;font-size:12px;flex-shrink:0;margin-left:6px;transition:background 0.2s,border-color 0.2s;';
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.4)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.5)';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.2)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.3)';
                });
                removeBtn.addEventListener('click', () => {
                    const index = tempExcludedNames.indexOf(name);
                    if (index > -1) {
                        tempExcludedNames.splice(index, 1);
                        refreshExcludedList();
                    }
                });

                row.appendChild(leftWrap);
                row.appendChild(removeBtn);
                excludedListDiv.appendChild(row);
            });

            tempExcludedIds.forEach(entry => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 6px;margin:2px 0;background:rgba(255,255,255,0.05);border-radius:3px;border-left:3px solid #e74c3c;';

                const leftWrap = document.createElement('div');
                leftWrap.style.cssText = 'display:flex;align-items:center;gap:6px;overflow:hidden;flex:1;';

                const badge = document.createElement('span');
                badge.textContent = 'ID';
                badge.style.cssText = 'font-size:9px;font-weight:bold;padding:1px 5px;border-radius:3px;background:rgba(231,76,60,0.25);color:#e74c3c;border:1px solid rgba(231,76,60,0.4);white-space:nowrap;flex-shrink:0;';

                const contentWrap = document.createElement('div');
                contentWrap.style.cssText = 'display:flex;align-items:baseline;gap:5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';

                const nameText = entry.name || (typeof Engine !== 'undefined' && Engine?.items?.getItemById?.(entry.id)?.name) || 'Nieznany przedmiot';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = nameText;
                nameSpan.title = `${nameText} (ID: ${entry.id})`;
                nameSpan.style.cssText = 'font-size:11px;color:#eee;font-weight:500;';

                const idSpan = document.createElement('span');
                idSpan.textContent = `(ID: ${entry.id})`;
                idSpan.style.cssText = 'font-size:10px;color:#aaa;';

                contentWrap.appendChild(nameSpan);
                contentWrap.appendChild(idSpan);

                leftWrap.appendChild(badge);
                leftWrap.appendChild(contentWrap);

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.title = 'Usuń wykluczenie';
                removeBtn.style.cssText = 'width:20px;height:20px;padding:0;background:rgba(200,60,60,0.2);border:1px solid rgba(200,60,60,0.3);color:#f99;cursor:pointer;border-radius:2px;font-size:12px;flex-shrink:0;margin-left:6px;transition:background 0.2s,border-color 0.2s;';
                removeBtn.addEventListener('mouseenter', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.4)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.5)';
                });
                removeBtn.addEventListener('mouseleave', () => {
                    removeBtn.style.background = 'rgba(200,60,60,0.2)';
                    removeBtn.style.borderColor = 'rgba(200,60,60,0.3)';
                });
                removeBtn.addEventListener('click', () => {
                    const index = tempExcludedIds.indexOf(entry);
                    if (index > -1) {
                        tempExcludedIds.splice(index, 1);
                        refreshExcludedList();
                    }
                });

                row.appendChild(leftWrap);
                row.appendChild(removeBtn);
                excludedListDiv.appendChild(row);
            });
            if (excludedListDiv._updateScrollBar) excludedListDiv._updateScrollBar();
        }
        refreshExcludedList();

        const lblIcon = document.createElement('label');
        lblIcon.textContent = 'Ikona (URL grafiki)';
        modal.appendChild(lblIcon);
        const inpIcon = document.createElement('input');
        inpIcon.type = 'text';
        inpIcon.value = editFilter ? editFilter.iconUrl : '';
        inpIcon.placeholder = 'https://example.com/icon.png';
        modal.appendChild(inpIcon);

        const preview = document.createElement('div');
        preview.className = 'sort-icon-preview';
        if (editFilter && editFilter.iconUrl) {
            preview.style.backgroundImage = `url('${editFilter.iconUrl}')`;
        }
        inpIcon.addEventListener('input', () => {
            preview.style.backgroundImage = inpIcon.value ? `url('${inpIcon.value}')` : '';
        });
        modal.appendChild(preview);

        const btnsDiv = document.createElement('div');
        btnsDiv.className = 'sort-modal-btns';

        const cancelBtn = document.createElement('div');
        cancelBtn.className = 'sort-modal-btn';
        cancelBtn.textContent = 'Anuluj';
        cancelBtn.addEventListener('click', closeFilterModal);

        const saveBtn = document.createElement('div');
        saveBtn.className = 'sort-modal-btn sort-btn-primary';
        saveBtn.textContent = 'Zapisz';
        saveBtn.addEventListener('click', () => {
            const name = inpName.value.trim();
            const expr = inpExpr.value.trim();
            const icon = inpIcon.value.trim();
            if (!name) { inpName.focus(); return; }

            if (editFilter) {
                const f = userFilters.find(f => f.id === editFilter.id);
                if (f) {
                    f.name = name;
                    f.expression = expr;
                    f.iconUrl = icon;
                    f.itemNames = [...tempItemNames];
                    f.itemIds = [...tempItemIds];
                    f.excludedNames = [...tempExcludedNames];
                    f.excludedIds = [...tempExcludedIds];
                }
            } else {
                const maxId = userFilters.reduce((m, f) => Math.max(m, f.id), 0);
                const newFilter = {
                    id: maxId + 1,
                    name,
                    expression: expr,
                    iconUrl: icon,
                    itemNames: [...tempItemNames],
                    itemIds: [...tempItemIds],
                    excludedNames: [...tempExcludedNames],
                    excludedIds: [...tempExcludedIds]
                };
                userFilters.push(newFilter);
            }
            save(KEYS.filters, userFilters);
            closeFilterModal();
            renderFilterTabs();
            refreshItems();
        });

        btnsDiv.appendChild(cancelBtn);
        btnsDiv.appendChild(saveBtn);
        modal.appendChild(btnsDiv);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        initCustomScrollBar(modal);
    }

    function closeFilterModal() {
        const m = document.getElementById('sort-modal-overlay');
        if (m) m.remove();
    }

    // ==================== INTERCEPTS & EVENTS ====================

    function setupEvents() {

        const intercept = (obj, key, cb, original = obj[key]) => {
            obj[key] = (...args) => {
                const result = original.apply(obj, args);
                cb(...args);
                return result;
            };
        };

        intercept(Engine.communication, 'parseJSON', (data) => {
            if (!isVisible || !panelEl) return;
            if (data && data.item) {
                    refreshItems();
            }
        });
    }

    // ==================== INITIALIZATION ====================

    const waitForGame = setInterval(() => {
        if (typeof Engine !== 'undefined' && Engine.communication && Engine.items) {
            clearInterval(waitForGame);
            initAddon();
        }
    }, 100);

    function initAddon() {
        // NAJPIERW załaduj ustawienia z pamięci
        userFilters     = load(KEYS.filters, []);
        deletedFilters  = load(KEYS.deletedFilters, []);
        currentFilterId = load(KEYS.active, 0);
        isVisible       = load(KEYS.visible, false);
        settings        = load(KEYS.settings, { itemClickMode: 'single', filtersVisible: true, hideGameBags: false, maxHeight: 246, sortMode: 'newest', filtersPosition: 'top', isPanelLocked: false, panelOpacity: 4, filterRows: 1, filterScale: 100 });
        isPanelLocked   = settings.isPanelLocked !== undefined ? settings.isPanelLocked : false;

        // Upewnij się że każdy filtr ma tablice itemNames, itemIds, excludedNames i excludedIds
        for (const f of userFilters) {
            if (!f.itemNames) f.itemNames = [];
            if (!f.itemIds) f.itemIds = [];
            if (!f.excludedNames) f.excludedNames = [];
            if (!f.excludedIds) f.excludedIds = [];
        }
        for (const f of deletedFilters) {
            if (!f.itemNames) f.itemNames = [];
            if (!f.itemIds) f.itemIds = [];
            if (!f.excludedNames) f.excludedNames = [];
            if (!f.excludedIds) f.excludedIds = [];
        }

        // POTEM twórz UI z załadowanymi ustawieniami
        createStyles();
        createToggleButton();
        createPanel();

        const defaultFilters = [
            {
                id: 0,
                name: "Wszystko",
                expression: "",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/bag/torba12.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 9,
                name: "Ulubione",
                expression: "",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/eve/g25-pet-c2u1.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 3,
                name: "Teleporty",
                expression: "teleport",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/neu/kam10.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 1,
                name: "KCS",
                expression: "timelimit&(custom_teleport|teleport&(rarity=unique|rarity=legendary))",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/neu/kamien3.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 6,
                name: "Ulepa",
                expression: "enhancementPoints|enhancement_add_point",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/upg/lege_enh_ball.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 2,
                name: "Mixy",
                expression: "leczy|fullheal|perheal|cl=21",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/pot/mix192.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 8,
                name: "Inne",
                expression: "!teleport&!custom_teleport&!enhancementPoints&!enhancement_add_point&!leczy&!fullheal&!perheal&!action=flee&!revive&!cl=25&!cl=21",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/neu/skrz_braciszek.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 4,
                name: "Ucieczki",
                expression: "action=flee",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/pap/pergamin12.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 5,
                name: "Skracajki",
                expression: "revive",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/eve/loteria_resp.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            },
            {
                id: 7,
                name: "Błogosławieństwa",
                expression: "cl=25",
                iconUrl: "https://micc.garmory-cdn.cloud/obrazki/itemy/ble/blo35.gif",
                itemNames: [],
                itemIds: [],
                excludedNames: [],
                excludedIds: []
            }
        ];

        // Jeśli to pierwsze uruchomienie (brak zapisanych filtrów), użyj domyślnych
        const savedFilters = load(KEYS.filters, null);
        if (savedFilters === null) {
            userFilters = defaultFilters;
            save(KEYS.filters, userFilters);
        }

        // Upewnij się że filtr "Wszystko" (id=0) istniuje w userFilters
        // (dla kompatybilności ze starszymi zapisanymi danymi)
        const wszystkoExists = userFilters.some(f => f.id === 0);
        if (!wszystkoExists) {
            const wszystkoFilter = defaultFilters.find(f => f.id === 0);
            if (wszystkoFilter) {
                userFilters.unshift(wszystkoFilter); // Dodaj na początek
                save(KEYS.filters, userFilters);
            }
        }

        if (settings.maxHeight === undefined) {
            settings.maxHeight = 246;
            save(KEYS.settings, settings);
        }
        if (settings.sortMode === undefined) {
            settings.sortMode = 'newest';
            save(KEYS.settings, settings);
        }

        if (isVisible) {
            toggleBtn.classList.add('sort-active');
            showPanel();
        }

        setupEvents();

        updateGameBagsVisibility();

        if (typeof API !== 'undefined' && API.addCallbackToEvent) {
            API.addCallbackToEvent(Engine.apiData.AFTER_INTERFACE_START, () => {
                if (isVisible) {
                    renderFilterTabs();
                    refreshItems();
                }
            });
        }
    }

})();
