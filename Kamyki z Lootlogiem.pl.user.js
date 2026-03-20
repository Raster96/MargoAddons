// ==UserScript==
// @name         Kamyki z Lootlogiem.pl
// @namespace    http://tampermonkey.net/
// @version      10.11.2024
// @description  Przeróbka dodatku Priweejta, który dodaje grafiki do kamyków. Dodano wyświetlanie timerów z lootlog.pl na teleportach.
// @author       You (edycja oryginalnego kodu autorstwa Priweejt)
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @grant        none
// ==/UserScript==

// JEŚLI NIE POKAZUJE GRAFIKI - POPRAW NAZWĘ MAPY NA TAKĄ JAK NA KAMYKU.
// JEŚLI NIE POKAZUJE TIMERA - POPRAW NAZWĘ E2 NA TAKĄ JAK NA LOOTLOGU NP. Terrozaur (urwisko).
// NIEKTÓRE KOLOSY MAM USTAWIONE O MAPĘ WCZEŚNIEJ PRZED PRZEDSIONKIEM, ZMIEŃTA SE
// JEŚLI DODATEK PRZESTAŁ DZIAŁAĆ POPRAW PRZECINKI I CUDZYSŁOWIA

// ====== TRYB TIMERA ======
// mode 1 - odlicza do średniego czasu (środek min/max respu, identycznie jak było na Groove), potem wyświetla 0:00 aż do maksymalnego czasu respu i znika
// mode 2 - odlicza do maksymalnego czasu respu, potem znika
const TIMER_MODE = 2;

// ====== GRAFIKI ======
// 0 - wyłączone (bez zmniejszania grafiki itema i bez dodawania grafiki e2)
// 1 - domyślnie włączone (zmniejsza grafikę itema i dodaje grafikę e2)
const SHOW_GRAPHICS = 1;

// ====== GRAFIKI NA TELEPORTACH Z UŻYCIAMI ======
// 0 - domyślnie wyłączone (grafiki tylko na kamykach)
// 1 - włączone (grafiki na wszystkich teleportach, również z użyciami)
const SHOW_GRAPHICS_ON_USE_TELEPORTS = 0;

const STONES_MAP = {
    // INNE
    "Błota Sham Al": [
        "Viviana Nandin",
        "https://micc.garmory-cdn.cloud/obrazki/npc/her/viv_nandin_i3bd1.gif"
    ],
    "Latarniane Wybrzeże": [
        "Hank",
        "https://micc.garmory-cdn.cloud/obrazki/npc/mez/tuz-pirat1.gif"
    ],
    "Strumienie Szemrzących Wód": [
        "Rybak",
        "https://micc.garmory-cdn.cloud/obrazki/npc/mez/tuz54.gif"
    ],
    "Port Tuzmer": [
        "Kendal",
        "https://micc.garmory-cdn.cloud/obrazki/npc/mez/tuz31.gif"
    ],
    "Osada Czerwonych Orków": [
        "Obłąkany Łowca orków",
        "https://micc.garmory-cdn.cloud/obrazki/npc/her/oblakany_ac1dae9d.gif"
    ],
    "Wyjący Wąwóz": [
        "Baca bez Łowiec",
        "https://micc.garmory-cdn.cloud/obrazki/npc/her/baca-bez-lowiec.gif"
    ],
    "Gvar Hamryd": [
        "Driady",
        "https://micc.garmory-cdn.cloud/obrazki/npc/hum/m_hamadriada-5b.gif"
    ],
    "Kryształowa Grota p.6": [
        "Lichwiarz Grauhaz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/her/lichwiarz_grauhaz.gif"
    ],
    // E2
    "Grota Dzikiego Kota": [
        "Mushita",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/st-puma.gif"
    ],
    "Las Tropicieli": [
        "Kotołak Tropiciel",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e1/kotolak_lowca.gif"
    ],
    "Przeklęta Strażnica - podziemia p.2 s.1": [
        "Shae Phu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/demonszef.gif"
    ],
    "Schowek na Łupy": [
        "Zorg Jednooki Baron",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/zbir-e2-zorg.gif"
    ],
    "Podmokła Dolina": [
        "Gobbos",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/gobsamurai.gif"
    ],
    "Pieczara Kwiku - sala 1": [
        "Tyrtajos",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/dzik.gif"
    ],
    "Skalne Turnie": [
        "Tollok Shimger",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/tollok_shimger.gif"
    ],
    "Stary Kupiecki Trakt": [
        "Szczęt Alias Gładki",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/zbir-szczet.gif"
    ],
    "Mokra Grota p.2": [
        "Agar",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/glut_agar.gif"
    ],
    "Stare Wyrobisko p.3": [
        "Razuglag Oklash",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/razuglag.gif"
    ],
    "Lazurytowa Grota p.4": [
        "Foverk Turrim",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/kobold07.gif"
    ],
    "Kopalnia Kapiącego Miodu p.2 - sala Owadziej Matki": [
        "Owadzia Matka",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/zadlak-e2-owadzia-matka.gif"
    ],
    "Wioska Gnolli": [
        "Vari Kruger",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/gnoll11.gif"
    ],
    "Jaskinia Gnollich Szamanów - komnata Kozuga": [
        "Furruk Kozug",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/gnoll12.gif"
    ],
    "Kamienna Jaskinia - sala 1": [
        "Jotun",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/kam_olbrzym-b.gif"
    ],
    "Głębokie Skałki p.4": [
        "Tollok Utumutu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/tollok_jask_utumatu.gif"
    ],
    "Głębokie Skałki p.3": [
        "Tollok Atamatu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/tollok_jask_atamatu.gif"
    ],
    "Krypty Dusz Śniegu p.2": [
        "Lisz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/lisz_demilisze.gif"
    ],
    "Erem Czarnego Słońca p.5": [
        "Grabarz Świątynny",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/nieu_mnich_grabarz.gif"
    ],
    "Firnowa Grota p.2": [
        "Wielka Stopa",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/wlochacze_wielka_stopa.gif"
    ],
    "Świątynia Andarum - zbrojownia": [
        "Podły Zbrojmistrz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/magaz_zbrojmistrz.gif"
    ],
    "Wylęgarnia Choukkerów p.3": [
        "Choukker (p.3)",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/dlawiciel5.gif"
    ],
    "Kopalnia Margorii": [
        "Nadzorczyni Krasnoludów",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/nadzorczyni_krasnoludow.gif"
    ],
    "Margoria - Sala Królewska": [
        "Morthen",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/krasnolud_boss.gif"
    ],
    "Zapomniany Święty Gaj p.2": [
        "Leśne Widmo",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/lesne_widmo.gif"
    ],
    "Grota Samotnych Dusz p.6": [
        "Żelazoręki Ohydziarz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/ugrape2.gif"
    ],
    "Kamienna Strażnica - Sala Chwały": [
        "Goplana",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/goplana.gif"
    ],
    "Zagrzybiałe Ścieżki p.3": [
        "Gnom Figlid",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/gnom_figlid.gif"
    ],
    "Dolina Centaurów": [
        "Centaur Zyfryd",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/cent-zyfryd.gif"
    ],
    "Las Dziwów": [
        "Kambion",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/kambion.gif"
    ],
    "Podziemia Zniszczonej Wieży p.5": [
        "Jertek Moxos",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/moloch-jertek.gif"
    ],
    "Zabłocona Jama p.2 - Sala Błotnistych Odmętów": [
        "Miłośnik Rycerzy",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/blotniaki_milosnik_rycerzy.gif"
    ],
    "Zabłocona Jama p.2 - Sala Magicznego Błota": [
        "Miłośnik Magii",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/blotniaki_milosnik_magii.gif"
    ],
    "Zabłocona Jama p.2 - Sala Duszącej Stęchlizny": [
        "Miłośnik Łowców",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/blotniaki_milosnik_lowcow.gif"
    ],
    "Skalne Cmentarzysko p.4": [
        "Łowca Czaszek (p.3)",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/alghul-czaszka-1a.gif"
    ],
    "Piramida Pustynnego Władcy p.3": [
        "Ozirus Władca Hieroglifów",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/mumia-ozirus.gif"
    ],
    "Jama Morskiej Macki p.1 - sala 3": [
        "Morski Potwór",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/osmiornica-1b.gif"
    ],
    "Góralskie Przejście": [
        "Wójt Fistuła",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/goral-e2-wojt-fistula.gif"
    ],
    "Chata wójta Fistuły": [
        "Wójt Fistuła",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/goral-e2-wojt-fistula.gif"
    ],
    "Wyspa Rem": [
        "Krab Pustelnik (wyspa)",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/krab_big3.gif"
    ],
    "Opuszczony statek - pokład pod rufą": [
        "Krab Pustelnik (statek)",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/krab_big3.gif"
    ],
    "Kryształowa Grota p.2 - sala 2": [
        "Królowa Śniegu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/krolowa-sniegu.gif"
    ],
    "Kryształowa Grota - Sala Smutku": [
        "Królowa Śniegu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/krolowa-sniegu.gif"
    ],

    "Babi Wzgórek": [
        "Teściowa Rumcajsa",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/goral-e2-tesciowa-rumcajsa.gif"
    ],
    "Wulkan Politraki p.1 - sala 3": [
        "Ifryt",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/magradit_ifryt.gif"
    ],
    "Ukryta Grota Morskich Diabłów - magazyn": [
        "Młody Jack Truciciel",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/pirat01.gif"
    ],
    "Piaszczysta Grota p.1 - sala 2": [
        "Eol",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/piaskowy_potwor-6a.gif"
    ],
    "Ukryta Grota Morskich Diabłów - siedziba": [
        "Helga Opiekunka Rumu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/pirat-2b.gif"
    ],
    "Ukryta Grota Morskich Diabłów - skarbiec": [
        "Henry Kaprawe Oko",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e1/pirat5b.gif"
    ],
    "Grota Orczej Hordy p.2 s.3": [
        "Burkog Lorulk",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/orkczd.gif"
    ],
    "Grota Orczych Szamanów p.3 s.1": [
        "Sheba Orcza Szamanka",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/r_orc_sheba.gif"
    ],
    "Kopalnia Żółtego Kruszcu p.2 - sala 1": [
        "Grubber Ochlaj",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/grubber-ochlaj.gif"
    ],
    "Cenotaf Berserkerów p.1 - sala 2": [
        "Berserker Amuno",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/amuno.gif"
    ],
    "Piaskowa Pułapka p.1 - sala 2": [
        "Stworzyciel",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/stworzyciel.gif"
    ],
    "Mała Twierdza - sala główna": [
        "Fodug Zolash",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/fodug_zolash.gif"
    ],
    "Kuźnia Worundriela - Komnata Żaru": [
        "Mistrz Worundriel",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/worundriel02.gif"
    ],
    "Lokum Złych Goblinów - warsztat": [
        "Goons Asterus",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/goons_asterus-1a.gif"
    ],
    "Laboratorium Adariel": [
        "Adariel",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/tri_adariel.gif"
    ],
    "Nawiedzone Kazamaty p.4": [
        "Duch Władcy Klanów",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/duch_wladcy_kl.gif"
    ],
    "Ogrza Kawerna p.4": [
        "Ogr Stalowy Pazur",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/ogr_stalowy_pazur-1a.gif"
    ],
    "Sala Rady Orków": [
        "Ziuggrael Strażnik Królowej",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/praork_woj_elita.gif"
    ],
    "Sala Królewska": [
        "Lusgrathera Królowa Pramatka",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/prakrolowa.gif"
    ],
    "Wyspa Ingotia": [
        "Borgoros Garamir III",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/ingotia_minotaur-7a.gif"
    ],
    "Drzewo Dusz p.2": [
        "Wrzosera",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/wrzosera-1b.gif"
    ],
    "Starodrzew Przedwiecznych p.2": [
        "Cerasus",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/cerasus-1a.gif"
    ],
    "Zalana Grota": [
        "Czempion Furboli",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/forbol03.gif"
    ],
    "Krypty Bezsennych p.3": [
        "Torunia Ankelwald",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/thuz-patr1.gif"
    ],
    "Przysiółek Valmirów": [
        "Breheret Żelazny Łeb",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/draki-breheret-1b.gif"
    ],
    "Szlamowe Kanały p.2 - sala 3": [
        "Mysiur Myświórowy Król",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/mysiur_myswiorowy_krol-1a.gif"
    ],
    "Skarpa Trzech Słów": [
        "Pięknotka Mięsożerna",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/zmutowana-roslinka.gif"
    ],
    "Przerażające Sypialnie": [
        "Sadolia Nadzorczyni Hurys",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/sekta-sadolia.gif"
    ],
    "Tajemnicza Siedziba": [
        "Gothardus Kolekcjoner Głów",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/sekta-gothardus.gif"
    ],
    "Przejście Oczyszczenia": [
        "Sataniel Skrytobójca",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/sekta-sataniel.gif"
    ],
    "Sale Rozdzierania": [
        "Bergermona Krwawa Hrabina",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/sekta-bergermona.gif"
    ],
    "Sala Tysiąca Świec": [
        "Zufulus Smakosz Serc",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/sekta-zufulus.gif"
    ],
    "Ołtarz Pajęczej Bogini": [
        "Marlloth Malignitas",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/marlloth.gif"
    ],
    "Jaszczurze Korytarze p.2 - sala 5": [
        "Mocny Maddoks",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/mocny_maddoks-1a.gif"
    ],
    "Arachnitopia p.6": [
        "Arachniregina Colosseus",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/regina-e2.gif"
    ],
    "Erem Aldiphrina": [
        "Al'diphrin Ilythirahel",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/drow-aldiphrin-wladca.gif"
    ],
    "Gnijące Topielisko": [
        "Arytodam Olbrzymi",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/arytodam_olbrzymi-1b.gif"
    ],
    "Gardziel Podgnitych Mchów p.3": [
        "Fangaj",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/grzyb-humanoid-1b.gif"
    ],
    "Jaskinia Korzennego Czaru p.1 - sala 1": [
        "Dendroculus",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/dendroculus.gif"
    ],
    "Złota Góra p.2 - sala 4": [
        "Tolypeutes",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/bolita.gif"
    ],
    "Niecka Xiuh Atl": [
        "Cuaitl Citlalin",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/maho-cuaitl.gif"
    ],
    "Potępione Zamczysko - sala ofiarna": [
        "Pogardliwa Sybilla",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/tri2_witch_e2.gif"
    ],
    "Siedlisko Przyjemnej Woni": [
        "Wabicielka",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/trist2_wabicielka-1a.gif"
    ],
    "Zachodni Mictlan p.8": [
        "Yaotl",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/mahoplowca.gif"
    ],
    "Wschodni Mictlan p.9": [
        "Quetzalcoatl",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/quetzalcoatl.gif"
    ],
    "Katakumby Gwałtownej Śmierci": [
        "Chopesz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/chopesh2.gif"
    ],
    "Grobowiec Seta": [
        "Neferkar Set",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/szkiel_set.gif"
    ],
    "Urwisko Vapora": [
        "Terrozaur (urwisko)",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/terrorzaur_pus.gif"
    ],
    "Jaskinia Smoczej Paszczy p.2": [
        "Terrozaur (jaskinia)",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/terrorzaur_pus.gif"
    ],
    "Świątynia Hebrehotha - sala ofiary": [
        "Vaenra Charkhaam",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/bar_smoczyca.gif"
    ],
    "Świątynia Hebrehotha - przedsionek": [
        "Chaegd Agnrakh",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/bar_smokoszef.gif"
    ],
    "Drzewo Życia p.2": [
        "Nymphemonia",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/nymphemonia.gif"
    ],
    "Sala Lodowej Magii": [
        "Artenius",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/wl-mrozu03.gif"
    ],
    "Sala Mroźnych Strzał": [
        "Furion",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/wl-mrozu02.gif"
    ],
    "Sala Mroźnych Szeptów": [
        "Zorin",
        "https://micc.garmory-cdn.cloud/obrazki/npc/e2/wl-mrozu01.gif"
    ],
    // TYTAN
    "Mroczna Pieczara p.0": [
        "Dziewicza Orlica",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/dziewicza_orlica.gif"
    ],
    "Grota Caerbannoga": [
        "Zabójczy Królik",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/zabojczy_krolik.gif"
    ],
    "Bandyckie Chowisko": [
        "Renegat Baulus",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/renegat_baulus.gif"
    ],
    "Wulkan Politraki - przedsionek": [
        "Piekielny Arcymag",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/archdemon.gif"
    ],
    "Lokum Złych Goblinów p.4": [
        "Versus Zoons",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/versus-zoons.gif"
    ],
    "Jaskinia Ulotnych Wspomnień": [
        "Łowczyni Wspomnień",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/lowcz-wspo-driady.gif"
    ],
    "Więzienie Demonów": [
        "Przyzywacz Demonów",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/przyz_demon_sekta.gif"
    ],
    "Nora Jaszczurzych Koszmarów p.1 - sala 2": [
        "Maddok Magua",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/maddok_magua-1b.gif"
    ],
    "Topan p.13": [
        "Tezcatlipoca",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/tezcatlipoca.gif"
    ],
    "Pustynia Shaiharrud - wschód": [
        "Barbatos Smoczy Strażnik",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/hebrehoth_smokoludzie.gif"
    ],
    "Przejście Władców Mrozu": [
        "Tanroth",
        "https://micc.garmory-cdn.cloud/obrazki/npc/tyt/ice_king.gif"
    ],
    // KOLOS
    "Pradawne Wzgórze Przodków": [
        "Mamlambo",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/mamlambo_final2.gif"
    ],
    "Pieczara Szaleńców - przedsionek": [
        "Regulus Mętnooki",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/bazyliszek.gif"
    ],
    "Archipelag Bremus An": [
        "Umibozu",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-wodnik.gif"
    ],
    "Skały Mroźnych Śpiewów": [
        "Amaimon Soploręki",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/soploreki.gif"
    ],
    "Czeluść Chimerycznej Natury - przedsionek": [
        "Hydrokora Chimeryczna",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/hydrokora.gif"
    ],
    "Jezioro Ważek": [
        "Vashkar",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-wazka.gif"
    ],
    "Przepaść Zadumy - przedsionek": [
        "Vashkar",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-wazka.gif"
    ],
    "Grobowiec Przeklętego Krakania - przedsionek": [
        "Lulukav",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolkrucz.gif"
    ],
    "Grota Przebiegłego Tkacza - przedsionek": [
        "Arachin Podstępny",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-pajak.gif"
    ],
    "Grota Martwodrzewów - przedsionek": [
        "Reuzen",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-dendro.gif"
    ],
    "Katakumby Krwawych Wypraw": [
        "Wernoradzki Drakolisz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-drakolisz.gif"
    ],
    "Katakumby Antycznego Gniewu - przedsionek": [
        "Wernoradzki Drakolisz",
        "https://micc.garmory-cdn.cloud/obrazki/npc/kol/kolos-drakolisz.gif"
    ],
};

function fetchLootlogTimers() {
    const cacheData = localStorage.getItem('ll:query-cache');
    if (!cacheData) return [];

    try {
        const cache = JSON.parse(cacheData);
        const timerQueries = cache.clientState?.queries?.filter(q =>
            q.queryKey?.[0] === 'guild-timers'
        ) || [];
        return timerQueries.flatMap(query => query.state?.data || []);
    } catch (e) {
        return [];
    }
}

function formatTime(totalSeconds) {
    if (totalSeconds <= 0) return "0:00";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getTimerText(timer, mode) {
    const now = Date.now();
    const minTime = new Date(timer.minSpawnTime).getTime();
    const maxTime = new Date(timer.maxSpawnTime).getTime();

    if (mode === 1) {
        const avgTime = Math.floor((minTime + maxTime) / 2);

        if (now < avgTime) {
            const remaining = Math.ceil((avgTime - now) / 1000);
            return formatTime(remaining);
        } else if (now < maxTime) {
            return "0:00";
        } else {
            return null;
        }
    } else if (mode === 2) {
        if (now < maxTime) {
            const remaining = Math.ceil((maxTime - now) / 1000);
            return formatTime(remaining);
        } else {
            return null;
        }
    }

    return null;
}

function loadItemImage(url) {
    const $newImg = document.createElement("img");
    $newImg.src = url;
    $newImg.classList.add("priw8-item-overlay");
    return new Promise(resolve => {
        $newImg.addEventListener("load", () => {
            let w = $newImg.width, h = $newImg.height;
            if (h > 32) {
                w = w * (32 / h);
                h = 32;
            }
            if (w > 32) {
                h = h * (32 / w);
                w = 32;
            }
            const offset = (32 - w) / 2;
            $newImg.width = w;
            $newImg.height = h;
            $newImg.style.left = `${offset}px`;
            $newImg.style.display = "block";

            resolve($newImg);
        });
    });
}

async function appendItemOverlay(id, url) {
    const $it = document.querySelector(`.item-id-${id}`);
    if ($it && !$it.querySelector(".priw8-item-overlay")) {
        if (SHOW_GRAPHICS === 1) {
            $it.classList.add("priw8-item-small-icon");
        }
        const $newImg = await loadItemImage(url);
        $newImg.style.position = "absolute";
        $newImg.zIndex = 1;
        const $canv = $it.querySelector("canvas");
        $canv.parentElement.appendChild($newImg);
    }
}

const drawStonesLabels = () => {
    const dragonStones = fetchDragonStones();
    const allTimers = fetchLootlogTimers();

    dragonStones.forEach((stone) => {
        const mapName = getMapName(stone._cachedStats);

        if (STONES_MAP.hasOwnProperty(mapName)) {
            const [monsterName, imageUrl] = STONES_MAP[mapName];

            const monsterNameLower = monsterName.toLowerCase();
            const timer = allTimers.find(t =>
                t.npc && t.npc.name.toLowerCase() === monsterNameLower
            );

            let timeText = null;
            if (timer) {
                timeText = getTimerText(timer, TIMER_MODE);
            }

            const existingLabel = $(`.item-id-${stone.id} .stone-label`);
            if (timeText !== null) {
                if (existingLabel.length > 0) {
                    existingLabel.text(timeText);
                } else {
                    const label = $(`<div class="stone-label">${timeText}</div>`);
                    $(`.item-id-${stone.id}`).append(label);
                }
            } else {
                existingLabel.remove();
            }

            const shouldShowGraphic = SHOW_GRAPHICS === 1 && imageUrl &&
                (SHOW_GRAPHICS_ON_USE_TELEPORTS === 1 || stone._cachedStats.hasOwnProperty("timelimit"));

            if (shouldShowGraphic) {
                appendItemOverlay(stone.id, imageUrl);
            }
        }
    });
};

const fetchDragonStones = () => {
    const allItems = Engine.items.fetchLocationItems("g");
    return allItems.filter((item) => {
        return item._cachedStats.hasOwnProperty("custom_teleport") || item._cachedStats.hasOwnProperty("teleport");
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
      z-Index: 1000;
  }
  .priw8-item-small-icon canvas.canvas-icon {
      width: 20px;
      height: 20px;
      top: 12px;
      z-index: 1;
  }
  .priw8-item-small-icon .amount, .priw8-item-small-icon .cooldown {
      z-index: 2;
  }
  </style>`);
    $("body").append(style);
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

    init();
})();