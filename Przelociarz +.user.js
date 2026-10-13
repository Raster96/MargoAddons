// ==UserScript==
// @name         Przelociarz +
// @version      1.4
// @description  Dodatek zapisuje timery użycia KCS-ów (oraz kamyków z licytek), a następnie za pomocą dodatków z Gargonem wyświetla informacje o kamykach.
// @author       You
// @match        *.margonem.pl/
// @exclude      https://www.margonem.pl/
// @exclude      https://www.margonem.pl//*.
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// ==/UserScript==

(function () {
    'use strict'

    // ==================== OPCJE KONFIGURACYJNE ====================
    const config = {
        addTimer: false, // domyślnie true, jak false to nie dodaje timerów na Minutnik + Priweejta (można wyłączyć, nie jest to wymagane do poprawnego działania addTeleportCounts)
        addTeleportCounts: true, // domyślnie true, jak false to nie dodaje i nie aktualizuje liczarki teleportów powyżej dodatku changeCharacter Priweejta (można wyłączyć, nie jest to wymagane do poprawnego działania addTimer)

        // dodatek domyślnie zapisuje wszystkie KCS oraz kamyki na stałe zawierające w opisie słowo "licytacja" - jeśli chcemy dodać lub usunąć jakiś kamyk trzeba to zrobić poniżej:

        // poniżej wpisujemy nazwy map, których NIE zapisujemy np. nazwy map z kamyków na kolosów/tytanów
        teleportBlacklist: [
            "Katakumby Antycznego Gniewu - przedsionek",
            "Czeluść Chimerycznej Natury - przedsionek",
            "Dziki Zagajnik",
            "Nora Jaszczurzych Koszmarów p.1 - sala 2",
            "Radosna Polana",
            "Zajazd pod Zielonym Jednorożcem p.1",
            "Kwieciste Kresy",
            "Strumienie Szemrzących Wód",
            "Latarniane Wybrzeże",
            'Pustynia Shaiharrud - wschód',
            'Pustynne Katakumby - Komnata Krwawych Wypraw',
            'Przejście Władców Mrozu',
            'Topan p.13',
            'Gvar Hamryd',
            'Port Tuzmer',
            'Skryty Azyl',
            'Grota Jaszczurzych Koszmarów p.2',
            'Grota Martwodrzewów - przedsionek',
            'Więzienie Demonów',
            'Grota Przebiegłego Tkacza - przedsionek',
            'Jaskinia Ulotnych Wspomnień',
            'Grobowiec Przeklętego Krakania - przedsionek',
            'Błota Sham Al',
            'Osada Czerwonych Orków',
            'Wulkan Politraki - przedsionek',
            'Lokum Złych Goblinów p.4',
            'Przepaść Zadumy - przedsionek',
            'Wyjący Wąwóz',
            'Babi Wzgórek',
            'Bandyckie Chowisko',
            'Archipelag Bremus An',
            'Zapomniany Szlak',
            'Grota Caerbannoga',
            'Mroczna Pieczara p.0',
            'Pieczara Szaleńców - przedsionek',
            'Pradawne Wzgórze Przodków',
            "Kryształowa Grota p.6",
            "Potępione Zamczysko",
        ],
        // poniżej wpisujemy nazwy map dla innych kamyków, które zapisujemy nawet jeśli nie są KCS i nie zawierają słowa "licytacja" np. Sala Królewska
        teleportWhitelist: [
            'Sala Królewska',
            'Kryształowa Grota p.2 - sala 2'],
    }
    // ===============================================================

const intercept = (obj, key, cb, original = obj[key]) => {
    obj[key] = (...args) => {
        const result = original.apply(obj, args)
        cb(...args)
        return result
    }
}

// ==================== STATYSTYKI ====================
const initStats = () => {
    let stats = GM_getValue("stats", {
        dailyTeleports: { value: 0, date: new Date().toLocaleDateString().slice(0, 10) },
        totalTeleports: { value: 0, startDate: new Date().toLocaleDateString().slice(0, 10) },
        dailyRecordTeleports: { value: 0, date: new Date().toLocaleDateString().slice(0, 10) }
    })

    const today = new Date().toLocaleDateString().slice(0, 10)

    if (stats.dailyTeleports.date !== today) {
        stats.dailyTeleports.value = 0
        stats.dailyTeleports.date = today
    }

    GM_setValue("stats", stats)
    return stats
}

const incrementTeleportStats = () => {
    let stats = initStats()
    const today = new Date().toLocaleDateString().slice(0, 10)

    stats.totalTeleports.value++
    if (!stats.totalTeleports.startDate) {
        stats.totalTeleports.startDate = today
    }

    if (stats.dailyTeleports.date !== today) {
        stats.dailyTeleports.value = 0
        stats.dailyTeleports.date = today
    }
    stats.dailyTeleports.value++

    if (stats.dailyTeleports.value > stats.dailyRecordTeleports.value) {
        stats.dailyRecordTeleports.value = stats.dailyTeleports.value
        stats.dailyRecordTeleports.date = today
    }

    GM_setValue("stats", stats)
    return stats
}

// ==================== WYŚWIETLANIE STATYSTYK ====================
const renderGlobalStats = (() => {
    let globalWrapper = null

    return function () {
        const parent = document.querySelector('.gargonem-change-character-charlist')
        const worldMenu = parent?.querySelector('.gargonem-change-character-world-menu')
        if (!parent || !worldMenu) return

        const stats = initStats()

        if (!globalWrapper) {
            globalWrapper = document.createElement('div')
            globalWrapper.className = 'gargonem-global-teleports'
            globalWrapper.style.display = 'flex'
            globalWrapper.style.alignItems = 'center'
            globalWrapper.style.marginLeft = '8px'
            globalWrapper.style.fontSize = '16px'
            globalWrapper.style.fontWeight = 'bold'
            globalWrapper.style.color = '#cac094'
            globalWrapper.style.pointerEvents = 'auto'
            globalWrapper.style.zIndex = '12'

            worldMenu.insertAdjacentElement('afterend', globalWrapper)
        }

        globalWrapper.textContent =
            `${stats.dailyTeleports.value}/${stats.totalTeleports.value}/${stats.dailyRecordTeleports.value}`

        $(globalWrapper).tip(
            `Legenda:<br>Dzienne teleporty<br>Łącznie teleportów:<br> od ${stats.totalTeleports.startDate}<br>Rekord dzienny:<br>${stats.dailyRecordTeleports.date}`
        )
    }
})()
// =============================================================

const saveTimerData = (charId, itemId, mapa, renewTimestamp, expires = null) => {
    let allTimers = GM_getValue('timery', {})

    for (const otherCharId in allTimers) {
        if (otherCharId !== charId && allTimers[otherCharId]?.[itemId]) {
            delete allTimers[otherCharId][itemId]
        }
    }

    if (!allTimers[charId]) {
        allTimers[charId] = {}
    }
    allTimers[charId][itemId] = {
        MAPA: mapa,
        RENEW: renewTimestamp,
    }
    if (expires) {
        allTimers[charId][itemId].EXPIRES = expires
    }
    GM_setValue('timery', allTimers)
}

const extractMapName = (parsedStats) => {
    if (!parsedStats || typeof parsedStats !== 'object') return null

    if (parsedStats.custom_teleport) {
        const parts = parsedStats.custom_teleport.split(',')
        return parts[3] || null
    }

    if (parsedStats.teleport) {
        const parts = parsedStats.teleport.split(',')
        const mapa = parts[3] || null
        if (mapa && config.teleportWhitelist.includes(mapa)) return mapa
        if (parsedStats.rarity === 'unique') return mapa
    }

    return null
}

const addGargonemTimer = (mapa, timeMinutes) => {
    const addTimerButton = document.querySelector('.gargonem-timer-add-btn')
    if (!addTimerButton) return
    addTimerButton.click()

    setTimeout(() => {
        const nameInput = document.querySelector('.gargonem-input.right-attached')
        const timeInput = document.querySelector('.gargonem-input.left-attached.left-border.right-attached')
        const addButton = document.querySelector('button.gargonem-button.left-attached.left-border.no-margin')
        if (!nameInput || !timeInput || !addButton) return

        nameInput.value = `KCS: ${mapa}`
        nameInput.dispatchEvent(new Event('input', { bubbles: true }))
        timeInput.value = `00:${timeMinutes}:00`
        timeInput.dispatchEvent(new Event('input', { bubbles: true }))
        Promise.resolve().then(() => addButton.click())
    }, 1)
}

let updateTeleportCounts = null

function initialize() {
    if (typeof Engine.communication === 'undefined') {
        setTimeout(initialize, 100);
        return;
    }

    intercept(Engine.communication, 'parseJSON', (data) => {
    if (data.t === 'reload' && typeof data.item === 'object') {
        const guest = Engine.hero.d.guest
        if (guest !== 'undefined' && guest === '1') return

        Object.entries(data.item).forEach(([itemId, item]) => {
            const charId = item.own
            let parsedStats = item.parsedStats

            if (!parsedStats && typeof item.stat === 'string') {
                parsedStats = {}
                item.stat.split(';').forEach((pair) => {
                    const [key, value] = pair.split('=')
                    if (key && value !== undefined) parsedStats[key] = value
                })
            }

            const mapa = extractMapName(parsedStats)
            if (!mapa || config.teleportBlacklist.includes(mapa)) return

            let renewTimestamp = null
            let timeMinutes = null
            if (parsedStats?.timelimit) {
                const parts = parsedStats.timelimit.split(',')
                if (parts.length >= 2) {
                    timeMinutes = parts[0]
                    renewTimestamp = parts[1]
                }
            }

            if (!timeMinutes || !renewTimestamp) return
            const expires = parsedStats?.expires || null

            saveTimerData(charId, itemId, mapa, renewTimestamp, expires)
            if (config.addTimer) addGargonemTimer(mapa, timeMinutes)

            if (config.addTeleportCounts) {
                incrementTeleportStats()
                updateTeleportCounts()
                renderGlobalStats()
            }
        })
    }
})
}

function run() {
    if (typeof Engine === 'undefined' || Engine.getInitLvl() !== 4) {
        setTimeout(run, 100);
        return;
    }
    initialize();
}

run();

if (config.addTeleportCounts) {
    (function initTeleportObserver() {
        const wrappersByCharId = Object.create(null)

        const slotWidth = 32
        const baseLeft = 16

        setInterval(() => {
            updateTeleportCounts()
            renderGlobalStats()
        }, 1000)

        const addTip = (element, text) => {
            $(element).tip(text)
        }

        updateTeleportCounts = function() {
            const container = document.querySelector('.gargonem-change-character-charlist-inner')
            if (!container) return
            if (!container.dataset.timerWrappersInit) {
                container.style.position = 'relative'
                container.dataset.timerWrappersInit = '1'
            }

            const charElems = container.querySelectorAll('.gargonem-change-character-char')
            const allTimers = GM_getValue('timery', {})
            const now = Math.floor(Date.now() / 1000)

            const visibleIds = new Set()

            charElems.forEach((charElem, index) => {
                const charId = charElem.dataset.charid
                if (!charId) return
                visibleIds.add(charId)

                let available = 0
                let total = 0
                const mapList = []

                if (allTimers[charId]) {
                    for (const itemId in allTimers[charId]) {
                        const timer = allTimers[charId][itemId]
                        if (!timer?.RENEW) continue
                        if (timer.EXPIRES && now >= Number(timer.EXPIRES)) continue
                        if (config.teleportBlacklist.includes(timer.MAPA)) continue

                        total++
                        if (now >= Number(timer.RENEW)) {
                            available++
                            if (timer.MAPA) mapList.push(timer.MAPA)
                        }
                    }
                }

                let percent = 0
                if (total > 0) percent = (available / total) * 100

                let color = '#4eff00'
                if (percent === 100) color = '#ff0000'
                else if (percent >= 50) color = '#ffa500'
                else if (percent >= 1) color = '#ffff00'

                const wrapperClass = 'gargonem-char-timer-wrapper'
                let wrapper = wrappersByCharId[charId]
                if (!wrapper || !container.contains(wrapper)) {
                    wrapper = document.createElement('div')
                    wrapper.className = wrapperClass
                    wrapper.dataset.for = charId
                    wrapper.style.position = 'absolute'
                    wrapper.style.top = '-18px'
                    wrapper.style.transform = 'translateX(-50%)'
                    wrapper.style.display = 'block'
                    wrapper.style.pointerEvents = 'none'
                    wrapper.style.zIndex = '10'

                    const icon = document.createElement('div')
                    icon.className = 'gargonem-char-timer-icon'
                    icon.dataset.for = charId
                    icon.style.position = 'static'
                    icon.style.fontSize = '16px'
                    icon.style.zIndex = '11'
                    icon.style.pointerEvents = 'auto'
                    wrapper.appendChild(icon)

                    container.appendChild(wrapper)
                    wrappersByCharId[charId] = wrapper
                }

                const left = baseLeft + (index * slotWidth)
                wrapper.style.left = left + 'px'

                const icon = wrapper.querySelector('.gargonem-char-timer-icon')
                icon.style.color = color
                icon.style.fontSize = '16px'
                icon.textContent = available

                if (mapList.length) {
                    addTip(icon, mapList.join('<br>'))
                } else {
                    addTip(icon, 'Brak dostępnych teleportów')
                }
            })

            for (const savedId in wrappersByCharId) {
                if (!visibleIds.has(savedId)) {
                    const node = wrappersByCharId[savedId]
                    if (node && node.parentNode) node.parentNode.removeChild(node)
                    delete wrappersByCharId[savedId]
                }
            }
        }
    })()
}
})();
