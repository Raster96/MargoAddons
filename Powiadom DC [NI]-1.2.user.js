// ==UserScript==
// @name         Powiadom DC [NI]
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Przerobione Heroes on Discord. Dodaje opcję "Powiadom DC" do kontekst menu wykrywacza herosów + timer (NI)
// @author       Based on Heroes on Discord by Kris Aphalon
// @match        http*://*.margonem.pl/
// @exclude      http*://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=discord.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function getCookie(name) {
    const regex = new RegExp(`(^| )${name}=([^;]+)`);
    const match = document.cookie.match(regex);
    if (match) return match[2];
  }

  const checkInterface = setInterval(() => {
    const iface = getCookie('interface');
    if (iface !== undefined) {
      clearInterval(checkInterface);
      if (iface !== 'ni') return;
      init();
    }
  }, 50);

  function init() {
    const STORAGE_KEY = 'powiadom-dc-webhook';

  function getWebhookUrl() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function setWebhookUrl(url) {
    localStorage.setItem(STORAGE_KEY, url);
  }

  function promptForWebhook() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

      const box = document.createElement('div');
      box.style.cssText =
        'background:#2c2f33;border:2px solid #7289da;border-radius:8px;padding:20px;width:420px;color:#fff;font-family:sans-serif;';

      const title = document.createElement('div');
      title.textContent = 'Powiadom DC - Webhook URL';
      title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:12px;color:#7289da;';
      box.appendChild(title);

      const desc = document.createElement('div');
      desc.textContent = 'Wklej link do webhooka Discord (poproś o niego zarządcę serwera Discord):';
      desc.style.cssText = 'font-size:13px;margin-bottom:10px;color:#dcddde;';
      box.appendChild(desc);

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'https://discord.com/api/webhooks/...';
      input.value = getWebhookUrl();
      input.style.cssText =
        'width:100%;box-sizing:border-box;padding:8px;border:1px solid #4f545c;border-radius:4px;background:#36393f;color:#dcddde;font-size:13px;margin-bottom:14px;';
      box.appendChild(input);

      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Anuluj';
      cancelBtn.style.cssText =
        'padding:6px 16px;border:none;border-radius:4px;background:#4f545c;color:#fff;cursor:pointer;font-size:13px;';
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(null);
      });

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Zapisz';
      saveBtn.style.cssText =
        'padding:6px 16px;border:none;border-radius:4px;background:#7289da;color:#fff;cursor:pointer;font-size:13px;';
      saveBtn.addEventListener('click', () => {
        const val = input.value.trim();
        if (val) {
          setWebhookUrl(val);
          document.body.removeChild(overlay);
          resolve(val);
        } else {
          input.style.borderColor = '#f04747';
        }
      });

      btnContainer.appendChild(cancelBtn);
      btnContainer.appendChild(saveBtn);
      box.appendChild(btnContainer);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      input.focus();
    });
  }

  function getMobType(warriorType) {
    if (warriorType >= 100) return 'titan';
    if (warriorType >= 90) return 'colossus';
    if (warriorType >= 80) return 'heroes';
    if (warriorType >= 40) return 'normal';
    if (warriorType >= 30) return 'elite3';
    if (warriorType >= 20) return 'elite2';
    if (warriorType >= 10) return 'elite';
    return 'normal';
  }

  function getServerName() {
    const worldName = Engine.worldConfig.getWorldName();
    return worldName[0].toUpperCase() + worldName.slice(1);
  }

  async function sendDiscordAlert(webhookUrl, playerNick, npcD, mapName) {
    let type1, type2, color;

    switch (getMobType(npcD.wt)) {
      case 'titan':
        type1 = 'Tytan'; type2 = 'tytana'; color = 3496447;
        break;
      case 'colossus':
        type1 = 'Kolos'; type2 = 'kolosa'; color = 10813692;
        break;
      case 'heroes':
        type1 = 'Heros'; type2 = 'herosa'; color = 16669435;
        break;
      case 'elite3':
        type1 = 'Elita III'; type2 = 'elitę III'; color = 16759351;
        break;
      case 'elite2':
        type1 = 'Elita II'; type2 = 'elitę II'; color = 4243455;
        break;
      case 'elite':
        type1 = 'Elita'; type2 = 'elitę'; color = 8912383;
        break;
      case 'normal':
      default:
        type1 = ''; type2 = 'NPCa'; color = 16708424;
    }

    const addToThumbnail = 'https://micc.garmory-cdn.cloud/obrazki/npc/';

    const response = await fetch(addToThumbnail + npcD.icon);
    const fileObj = new File([await response.blob()], 'npc.gif');
    const lvl = npcD.lvl > 0 ? `(${npcD.lvl}${npcD.prof ?? ''})` : '';

    const timestamp = npcD.killSeconds
      ? `\n\n**Zniknie za**: ${(() => {
          let t = Math.round(npcD.killSeconds + Date.now() / 1e3);
          return `<t:${t}:R>`;
        })()}`
      : '';

    const serverName = getServerName();

    const data = new FormData();
    data.append('files[0]', fileObj);
    data.append(
      'payload_json',
      JSON.stringify({
        content: `**@here${type1 ? ' ' + type1 : ''}**: ${npcD.nick} ${lvl} - ${mapName} (${npcD.x}, ${npcD.y})`,
        username: 'Wysłannik zakonu',
        avatar_url:
          'https://cdn.discordapp.com/attachments/739058959083896844/1118230046683959307/heroes-on-discord-avatar.png',
        embeds: [
          {
            color,
            title: `${playerNick} znalazł ${type2}!`,
            description: `${npcD.nick} ${lvl} - ${mapName} (${npcD.x}, ${npcD.y}) - ${serverName}${timestamp}`,
            thumbnail: { url: 'attachment://npc.gif' },
            timestamp: new Date().toISOString(),
          },
        ],
      })
    );

    const request = new XMLHttpRequest();
    request.open('POST', webhookUrl);
    request.send(data);
  }

  // ==================== TIMER ====================

  // Format seconds to HH:MM:SS (same as game's getSecondLeft with noVar)
  function formatTime(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;
    const sec = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60);
    const min = m % 60;
    const h = Math.floor(m / 60) % 24;
    const sH = h > 9 ? '' + h : '0' + h;
    const sM = min > 9 ? '' + min : '0' + min;
    const sS = sec > 9 ? '' + sec : '0' + sec;
    return sH + ':' + sM + ':' + sS;
  }

  // Color logic identical to game's interfaceTimer/CharacterTimer.js getColor()
  function getTimerColor(sec) {
    if (sec > 60) return '#ffffff';   // white
    if (sec > 0)  return '#ffa500';   // orange
    return '#ff0000';                  // red
  }

  // Inject a live countdown timer into a detector window
  function injectTimer(detectorEl, npcObj) {
    if (!npcObj || !npcObj.d || !npcObj.d.killSeconds) return;

    // Calculate the absolute end timestamp (unix seconds)
    const endTime = Math.round(Date.now() / 1000) + npcObj.d.killSeconds;

    const timerEl = document.createElement('div');
    timerEl.className = 'powiadom-dc-timer';
    timerEl.style.cssText = 'text-align:center;margin-top:4px;font-size:13px;font-weight:bold;';

    // Insert after map-label
    const mapLabel = detectorEl.querySelector('.map-label');
    if (mapLabel && mapLabel.parentNode) {
      mapLabel.parentNode.insertBefore(timerEl, mapLabel.nextSibling);
    } else {
      detectorEl.appendChild(timerEl);
    }

    function tick() {
      const remaining = endTime - Math.round(Date.now() / 1000);
      timerEl.textContent = formatTime(Math.max(remaining, 0));
      timerEl.style.color = getTimerColor(remaining);
      if (remaining <= 0) return; // stop updating when expired
      requestAnimationFrame(tick);
    }
    tick();
  }

  // ==================== NPC LOOKUP ====================

  function findNpcDataFromDetector(detectorEl) {
    const nameLabel = detectorEl.querySelector('.name-label');
    const npcDisplayName = nameLabel ? nameLabel.textContent.trim() : '';

    // Extract just the nick (without level info in parentheses)
    const nickMatch = npcDisplayName.match(/^(.+?)\s*(?:\(|$)/);
    const npcNick = nickMatch ? nickMatch[1].trim() : npcDisplayName;

    // Search through npcs on the current map
    const npcs = Engine.npcs?.getDrawableList?.() || [];
    for (const npc of npcs) {
      if (npc.d && npc.d.nick === npcNick) {
        return npc;
      }
    }

    // Fallback: try Engine.npcs.list
    if (Engine.npcs?.list) {
      for (const id in Engine.npcs.list) {
        const npc = Engine.npcs.list[id];
        if (npc?.d?.nick === npcNick) {
          return npc;
        }
      }
    }

    return null;
  }

  // ==================== HOOK ====================

  let initInterval = setInterval(() => {
    if (Engine?.interface?.showPopupMenu) {
      clearInterval(initInterval);

      const originalShowPopupMenu = Engine.interface.showPopupMenu;
      Engine.interface.showPopupMenu = function (menu, e, onMap) {
        const target = e?.target || e?.originalEvent?.target || e?.currentTarget;
        const isDetectorMenu =
          target &&
          (target.closest?.('.heros-detector') ||
            (target.classList?.contains('icon') &&
              target.parentElement?.classList?.contains('heros-detector')));

        if (isDetectorMenu) {
          const detectorEl = target.closest('.heros-detector') || target.parentElement;
          if (detectorEl) {
            // Insert as second option (index 1)
            const dcOption = [
              'Powiadom DC',
              async () => {
                let webhookUrl = getWebhookUrl();
                if (!webhookUrl) {
                  webhookUrl = await promptForWebhook();
                  if (!webhookUrl) return;
                }

                const npcObj = findNpcDataFromDetector(detectorEl);
                if (npcObj && npcObj.d) {
                  const playerNick = `${Engine.hero.nick} (${Engine.hero.d.lvl}${Engine.hero.d.prof ?? ''})`;
                  const mapName = Engine.map.d.name;
                  await sendDiscordAlert(webhookUrl, playerNick, npcObj.d, mapName);
                  message('Powiadomienie na Discord wysłane!');
                } else {
                  message('Nie udało się znaleźć danych NPC.');
                }
              },
            ];

            // Add as second item (after the first existing option)
            if (menu.length >= 1) {
              menu.splice(1, 0, dcOption);
            } else {
              menu.push(dcOption);
            }
          }
        }

        originalShowPopupMenu.call(this, menu, e, onMap);
      };

      // ==================== INJECT TIMERS INTO DETECTOR WINDOWS ====================
      // Watch for new detector windows being added and inject timers
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            // Look for detector content divs
            const detectors = node.classList?.contains('heros-detector')
              ? [node]
              : Array.from(node.querySelectorAll('.heros-detector'));

            for (const det of detectors) {
              // Only inject if not already done
              if (det.querySelector('.powiadom-dc-timer')) continue;

              // Small delay to allow the detector to fully populate
              setTimeout(() => {
                if (det.querySelector('.powiadom-dc-timer')) return;
                const npcObj = findNpcDataFromDetector(det);
                injectTimer(det, npcObj);
              }, 200);
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Also check any already-existing detector windows
      document.querySelectorAll('.heros-detector').forEach((det) => {
        if (det.querySelector('.powiadom-dc-timer')) return;
        const npcObj = findNpcDataFromDetector(det);
        injectTimer(det, npcObj);
      });
    }
  }, 100);
  }
})();
