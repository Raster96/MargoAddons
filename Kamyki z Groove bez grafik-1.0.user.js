// ==UserScript==
// @name         Kamyki z Groove
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Wyświetla timer z lootloga na teleportach. Bez grafiki.
// @author       You
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @grant        none
// ==/UserScript==

// Nazwa_MAPKI - nazwa widoczna w opisie na tp, nie tam gdzie jest e2
// Nazwa_E2 - nazwa e2 widoczna na timerze groove, jesli jest napisane Choukker (p.3) przepisujemy całość

const STONES_MAP = {
  // NAZWA_MAPKI: "NAZWA_E2"
  "Błota Sham Al": "Viviana Nandin",
  "Latarniane Wybrzeże": "Hank",
  "Strumienie Szemrzących Wód": "Rybak",
  "Port Tuzmer": "Kendal",
  "Osada Czerwonych Orków": "Obłąkany Łowca orków",
  "Wyjący Wąwóz": "Baca bez Łowiec",
  "Gvar Hamryd": "Driady",
  "Grota Dzikiego Kota": "Mushita",
  "Las Tropicieli": "Kotołak Tropiciel",
  "Przeklęta Strażnica - podziemia p.2 s.1": "Shae Phu",
  "Schowek na Łupy": "Zorg Jednooki Baron",
  "Podmokła Dolina": "Gobbos",
  "Pieczara Kwiku - sala 1": "Tyrtajos",
  "Skalne Turnie": "Tollok Shimger",
  "Stary Kupiecki Trakt": "Szczęt Alias Gładki",
  "Mokra Grota p.2": "Agar",
  "Stare Wyrobisko p.3": "Razuglag Oklash",
  "Lazurytowa Grota p.4": "Foverk Turrim",
  "Kopalnia Kapiącego Miodu p.2 - sala Owadziej Matki": "Owadzia Matka",
  "Wioska Gnolli": "Vari Kruger",
  "Jaskinia Gnollich Szamanów p.3": "Furruk Kozug",
  "Kamienna Jaskinia - sala 1": "Jotun",
  "Głębokie Skałki p.4": "Tollok Utumutu",
  "Głębokie Skałki p.3": "Tollok Atamatu",
  "Krypty Dusz Śniegu p.2": "Lisz",
  "Erem Czarnego Słońca p.5": "Grabarz świątynny",
  "Firnowa Grota p.2": "Wielka Stopa",
  "Świątynia Andarum - zbrojownia": "Podły Zbrojmistrz",
  "Wylęgarnia Choukkerów p.3": "Choukker (p.3)",
  "Kopalnia Margorii": "Nadzorczyni krasnoludów",
  "Margoria - Sala Królewska": "Morthen",
  "Zapomniany Święty Gaj p.2": "Leśne Widmo",
  "Grota Samotnych Dusz p.6": "Żelazoręki Ohydziarz",
  "Kamienna Strażnica - Sala Chwały": "Goplana",
  "Zagrzybiałe Ścieżki p.3": "Gnom Figlid",
  "Dolina Centaurów": "Centaur Zyfryd",
  "Las Dziwów": "Kambion",
  "Podziemia Zniszczonej Wieży p.5": "Jertek Moxos",
  "Zabłocona Jama p.2 - Sala Błotnistych Odmętów": "Miłośnik Rycerzy",
  "Zabłocona Jama p.2 - Sala Magicznego Błota": "Miłośnik Magii",
  "Zabłocona Jama p.2 - Sala Duszącej Stęchlizny": "Miłośnik Łowców",
  "Skalne Cmentarzysko p.4": "Łowca Czaszek (p.3)",
  "Piramida Pustynnego Władcy p.3": "Ozirus Władca Hieroglifów",
  "Jama Morskiej Macki p.1 - sala 3": "Morski potwór",
  "Góralskie Przejście": "Wójt Fistuła",
  "Wyspa Rem": "Krab pustelnik",
  "Kryształowa Grota p.2 - sala 2": "Królowa Śniegu",
  "Babi Wzgórek": "Teściowa Rumcajsa",
  "Wulkan Politraki p.1 - sala 3": "Ifryt",
  "Ukryta Grota Morskich Diabłów - magazyn": "Młody Jack Truciciel",
  "Piaszczysta Grota p.1 - sala 2": "Eol",
  "Ukryta Grota Morskich Diabłów - siedziba": "Helga Opiekunka Rumu",
  "Ukryta Grota Morskich Diabłów - skarbiec": "Henry Kaprawe Oko",
  "Grota Orczej Hordy p.2 s.3": "Burkog Lorulk",
  "Grota Orczych Szamanów p.3 s.1": "Sheba Orcza Szamanka",
  "Kopalnia Żółtego Kruszcu p.2 - sala 1": "Grubber Ochlaj",
  "Cenotaf Berserkerów p.1 - sala 2": "Berserker Amuno",
  "Piaskowa Pułapka p.1 - sala 2": "Stworzyciel",
  "Mała Twierdza - sala główna": "Fodug Zolash",
  "Kuźnia Worundriela - Komnata Żaru": "Mistrz Worundriel",
  "Lokum Złych Goblinów - warsztat": "Goons Asterus",
  "Laboratorium Adariel": "Adariel",
  "Nawiedzone Kazamaty p.4": "Duch Władcy Klanów",
  "Ogrza Kawerna p.4": "Ogr Stalowy Pazur",
  "Sala Rady Orków": "Ziuggrael Strażnik Królowej",
  "Sala Królewska": "Lusgrathera Królowa Pramatka",
  "Wyspa Ingotia": "Borgoros Garamir III",
  "Drzewo Dusz p.2": "Wrzosera",
  "Starodrzew Przedwiecznych p.2": "Cerasus",
  "Zalana Grota": "Czempion Furboli",
  "Krypty Bezsennych p.3": "Torunia Ankelwald",
  "Przysiółek Valmirów": "Breheret Żelazny Łeb",
  "Szlamowe Kanały p.2 - sala 3": "Mysiur Myświórowy Król",
  "Skarpa Trzech Słów": "Pięknotka Mięsożerna",
  "Przerażające Sypialnie": "Sadolia Nadzorczyni Hurys",
  "Tajemnicza Siedziba": "Gothardus Kolekcjoner Głów",
  "Przejście Oczyszczenia": "Sataniel Skrytobójca",
  "Sale Rozdzierania": "Bergermona Krwawa Hrabina",
  "Sala Tysiąca Świec": "Zufulus Smakosz Serc",
  "Ołtarz Pajęczej Bogini": "Marlloth Malignitas",
  "Grota Błotnej Magii": "Mocny Maddoks",
  "Arachnitopia p.5": "Arachniregina Colosseus",
  "Jaszczurze Korytarze p.4 - sala 3": "Pancerny Maddok",
  "Krzaczasta Grota - korytarz": "Silvanasus",
  "Jaskinia Korzennego Czaru p.1 - sala 1": "Dendroculus",
  "Złota Góra p.2 sala 1": "Tolypeutes",
  "Niecka Xiuh Atl": "Cuaitl Citlalin",
  "Potępione Zamczysko - sala ofiarna": "Pogardliwa Sybilla",
  "Zachodni Mictlan p.8": "Yaotl",
  "Wschodni Mictlan p.9": "Quetzalcoatl",
  "Katakumby Gwałtownej Śmierci": "Chopesz",
  "Grobowiec Seta": "Neferkar Set",
  "Urwisko Vapora": "Terrozaur (urwisko)",
  "Jaskinia Smoczej Paszczy p.2": "Terrozaur (jaskinia)",
  "Świątynia Hebrehotha - sala ofiary": "Vaenra Charkhaam",
  "Świątynia Hebrehotha - przedsionek": "Chaegd Agnrakh",
  "Drzewo Życia p.2": "Nymphemonia",
  "Sala Lodowej Magii": "Artenius",
  "Sala Mroźnych Strzał": "Furion",
  "Sala Mroźnych Szeptów": "Zorin",
  "Mroczna Pieczara p.0": "Dziewicza Orlica",
  "Grota Caerbannoga": "Zabójczy Królik",
  "Bandyckie Chowisko": "Renegat Baulus",
  "Wulkan Politraki - przedsionek": "Piekielny Arcymag",
  "Lokum Złych Goblinów p.4": "Versus Zoons",
  "Jaskinia Ulotnych Wspomnień": "Łowczyni Wspomnień",
  "Więzienie Demonów": "Przyzywacz Demonów",
  "Nora Jaszczurzych Koszmarów p.1 - sala 2": "Maddok Magua",
  "Topan p.13": "Tezcatlipoca",
  "Pustynia Shaiharrud - wschód": "Barbatos Smoczy Strażnik",
  "Przejście Władców Mrozu": "Tanroth",
  "Pradawne Wzgórze Przodków": "Mamlambo",
  "Pieczara Szaleńców - przedsionek": "Regulus Mętnooki",
  "Archipelag Bremus An": "Umibozu",
  "Skały Mroźnych Śpiewów": "Amaimon Soploręki",
  "Czeluść Chimerycznej Natury - przedsionek": "Hydrokora Chimeryczna",
  "Jezioro Ważek": "Vashkar",
  "Przepaść Zadumy - przedsionek": "Vashkar",
  "Grobowiec Przeklętego Krakania - przedsionek": "Lulukav",
  "Grota Przebiegłego Tkacza - przedsionek": "Arachin Podstępny",
  "Grota Martwodrzewów - przedsionek": "Reuzen",
  "Katakumby Krwawych Wypraw": "Wernoradzki Drakolisz"
};

(function () {
  const init = () => {
    try {
      if (!Engine.interface.getAlreadyInitialised()) {
        setTimeout(init, 500);
        return;
      }
    } catch (error) {
      setTimeout(init, 500);
    }

    setupCSS();
    drawStonesLabels();

    setInterval(drawStonesLabels, 1000);
  };

  const fetchDragonStones = () => {
    const allItems = Engine.items.fetchLocationItems("g");
    const dragonStones = allItems.filter((item) => {
      return item._cachedStats.hasOwnProperty("custom_teleport") || item._cachedStats.hasOwnProperty("teleport");
    });

    return dragonStones;
  };

  const drawStonesLabels = () => {
    const dragonStones = fetchDragonStones();

    dragonStones.forEach((stone) => {
      const mapName = getMapName(stone._cachedStats);

      if (STONES_MAP.hasOwnProperty(mapName)) {
        const monsterName = $(".cll-timer-monster").filter(function () {
          return $(this).text().trim() === STONES_MAP[mapName];
        });

        if (monsterName.length > 0) {
          const timerElement = monsterName.siblings(".cll-timer-time");
          const timeText = timerElement.text().trim();

          const existingLabel = $(`.item-id-${stone.id} .stone-label`);
          if (existingLabel.length > 0) {
            existingLabel.text(timeText);
          } else {
            if (timeText) {
              const label = $(`<div class="stone-label">${timeText}</div>`);
              $(`.item-id-${stone.id}`).append(label);
            }
          }
        } else {
          $(`.item-id-${stone.id} .stone-label`).remove();
        }
      }
    });
  };

  const getMapName = (stats) => {
    const teleportStat = stats.custom_teleport || stats.teleport;
    if (teleportStat) {
      const parts = teleportStat.split(",");
      return parts[parts.length - 1].trim();
    }
    return null;
  };

  const setupCSS = () => {
    const style = $(`<style>.stone-label {
        position: absolute;
        top: 20px;
        height: 16px;
        width: 32px;
        text-align: center;
        color: white;
        pointer-events: none;
        text-shadow: -2px 0 black, 0 2px black, 2px 0 black, 0 -2px black;
        font-size: 0.55rem;
    }</style>`);
    $("body").append(style);
  };

  init();
})();
