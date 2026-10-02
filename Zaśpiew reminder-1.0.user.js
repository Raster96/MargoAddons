// ==UserScript==
// @name         Zaśpiew reminder
// @version      1.0.3
// @author       You
// @description  Po rozpoczęciu walki z tytanem wyświetla żółty komunikat przypominający o użyciu zaśpiewów (tylko tych na stałe z cooldownem)
// @match        *.margonem.pl/
// @exclude      https://www.margonem.pl/
// @exclude      https://www.margonem.pl//*.
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function initialize() {
        if (typeof Engine === 'undefined' || typeof Engine.communication === 'undefined') {
            setTimeout(initialize, 100);
            return;
        }

        const intercept = (obj, key, cb, _ = obj[key]) => obj[key] = (...args) => {
            const result = _.apply(obj, args);
            return cb(...args) ?? result;
        };

        intercept(Engine.communication, 'parseJSON', (data) => {
            if (data.f && data.npcs && data.npcs[0] && data.npcs[0].wt > 99) {
                const items = Engine.items.fetchLocationItems("g");

                if (items && Array.isArray(items)) {
                    items.forEach(item => {
                        if (item._cachedStats.battlestats && item._cachedStats.timelimit) {
                            message(`Przypomnienie o użyciu przedmiotu ${item.name}.`);
                        }
                    });
                }
            }
        });
    }

    initialize();
})();
