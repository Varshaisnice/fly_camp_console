// FlyCamp – base functionality with improved initialisation sequence

let username = "";
let rfidTag = "";
let selectedGameId = null;
let selectedGameTitle = "";
let selectedGameDesc = "";
let scanInterval = null;
let scanningActive = true;

// Controller toggle (UI-only text swap)
let controllerMode = 'joystick';
const WORD_A = 'Joystick Controller';
const WORD_B = 'Hand Gesture Controller';

// Helpers to query DOM
const qs  = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------------------------------------------ */
/* Navigation                                                         */
/* ------------------------------------------------------------------ */

function goToPage(id) {
  console.log('goToPage called with id:', id);
  // Hide all screens
  qsa('.screen').forEach(s => {
    s.classList.remove('active');
    console.log('Hiding screen:', s.id);
  });
  // Show the requested page
  const pageEl = qs(`#${id}`);
  if (pageEl) {
    pageEl.classList.add('active');
    console.log('Showing page:', id);
  } else {
    console.error('Page not found:', id);
  }
  // Always use the default blue background for every page
  document.body.style.backgroundColor =
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  // If returning to choose-game page, recenter on Hue’s the Boss
  if (id === 'page_choose_game') {
    const slider = qs('#game-card-container');
    if (slider && typeof slider.centerOnSecondCard === 'function') {
      slider.centerOnSecondCard();
    }
  }
  // Update rules when navigating to confirm or initializing page
  if (id === 'page_confirm') {
    updateConfirmPageRules();
  }
  if (id === 'page_initializing') {
    updateInitPageRules();
  }
}

/** Navigate back to the choose-game page. */
function backToChoose() {
  goToPage('page_choose_game');
}

/* ------------------------------------------------------------------ */
/* Controller toggle (Joystick vs Hand Gesture)                       */
/* ------------------------------------------------------------------ */

function updateControllerLabels() {
  const root = document.body;
  const toWord = (controllerMode === 'joystick') ? WORD_A : WORD_B;
  const fromWord = (controllerMode === 'joystick') ? WORD_B : WORD_A;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const txt = node.nodeValue;
      if (!txt) return NodeFilter.FILTER_SKIP;
      const lower = txt.toLowerCase();
      if (lower.includes(WORD_A.toLowerCase()) ||
          lower.includes(WORD_B.toLowerCase())) {
        const p = node.parentElement;
        if (p && p.offsetParent !== null) return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    let t = node.nodeValue;
    t = t.replace(new RegExp(WORD_A, 'ig'), WORD_A);
    t = t.replace(new RegExp(WORD_B, 'ig'), WORD_B);
    t = t.replace(new RegExp(fromWord, 'ig'), toWord);
    node.nodeValue = t;
  });
}

function registerControllerToggle() {
  const btn = qs('#logo-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    controllerMode = (controllerMode === 'joystick') ? 'gesture' : 'joystick';
    updateControllerLabels();
  });
}

/* ------------------------------------------------------------------ */
/* RFID scanning                                                      */
/* ------------------------------------------------------------------ */

function beginAutoScan() {
  const loader = qs('#loader1');
  if (loader) loader.textContent = 'Waiting for token...';
  scanInterval = setInterval(() => {
    if (!scanningActive) return;
    fetch('/scan_rfid')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          username = d.name;
          rfidTag = d.token_id;
          if (loader) loader.textContent = `Hi ${username}!`;
          setTimeout(() => {
            qs('#greeting').textContent = `Hi ${username}!`;
            qs('#user-info').textContent = `Token number: ${rfidTag}`;
            goToPage('page2');
          }, 600);
        }
      })
      .catch(err => console.error('RFID scan error:', err));
  }, 5000);
}

function confirmPlayer() {
  scanningActive = false;
  if (scanInterval) clearInterval(scanInterval);
  goToPage('page_choose_game');
}

/* ------------------------------------------------------------------ */
/* Game selection slider                                              */
/* ------------------------------------------------------------------ */

function initializeCardSlider(selector) {
  const slider = qs(selector);
  if (!slider) {
    console.error('Slider not found for selector:', selector);
    return;
  }
  const cards = qsa('.card', slider);
  if (cards.length === 0) {
    console.error('No game cards found in slider:', selector);
    return;
  }

  console.log('Found', cards.length, 'game cards');

  // Pause all videos so only one plays at a time
  cards.forEach(card => {
    const vid = card.querySelector('.card-video');
    if (vid) {
      vid.pause();
      vid.currentTime = 0;
    } else {
      console.warn('No video element found in card:', card);
    }
  });

  function updateActiveCard() {
    const centre = slider.scrollLeft + slider.clientWidth / 2;
    let closest = null;
    let minDist = Infinity;
    cards.forEach(card => {
      const cc = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cc - centre);
      if (dist < minDist) {
        minDist = dist;
        closest = card;
      }
    });
    cards.forEach(card => {
      const vid = card.querySelector('.card-video');
      if (card === closest) {
        card.classList.add('is-active');
        if (vid) vid.play().catch(err => console.error('Video play error:', err));
      } else {
        card.classList.remove('is-active');
        if (vid) {
          vid.pause();
          vid.currentTime = 0;
        }
      }
    });
  }

  // Debounce scrolling to avoid jitter
  let scrollTimeout;
  slider.addEventListener('scroll', () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(updateActiveCard, 80);
  });

  // When a card is clicked, capture its metadata and go to the confirm screen
  cards.forEach((card, index) => {
    card.addEventListener('click', (event) => {
      console.log(`Card ${index + 1} clicked:`, card.dataset.gameId, card.dataset.title);
      try {
        const gameId = card.getAttribute('data-game-id');
        selectedGameId = parseInt(gameId, 10);
        selectedGameTitle = card.getAttribute('data-title') || 'Unknown Game';
        selectedGameDesc = card.getAttribute('data-desc') || '';
        const src = card.getAttribute('data-video') || '/static/assets/video1.mp4';

        if (!selectedGameId || isNaN(selectedGameId)) {
          console.error('Invalid game ID:', gameId);
          return;
        }

        const titleEl = qs('#chosen-game-title');
        const descEl = qs('#chosen-game-desc');
        const videoEl = qs('#game-video');

        if (!titleEl || !descEl || !videoEl) {
          console.error('Confirm page elements missing:', {
            titleEl: !!titleEl,
            descEl: !!descEl,
            videoEl: !!videoEl
          });
          return;
        }

        titleEl.textContent = `You chose: ${selectedGameTitle}`;
        descEl.textContent = selectedGameDesc;
        videoEl.setAttribute('data-src', src);

        console.log('Navigating to page_confirm with game:', {
          id: selectedGameId,
          title: selectedGameTitle,
          desc: selectedGameDesc,
          video: src
        });
        goToPage('page_confirm');

        // Reset initialization state
        window.__initStarted = false;
        window.__initReady = false;
        window.__initSuccess = false;
      } catch (err) {
        console.error('Error in card click handler:', err);
      }
    });
  });

  function centreOnSecondCard() {
    const second = cards[1];
    if (!second) {
      console.error('Second card not found for centering');
      return;
    }
    const offset = second.offsetLeft - (slider.clientWidth / 2) + (second.clientWidth / 2);
    slider.scrollLeft = offset;
    updateActiveCard();
  }

  slider.centerOnSecondCard = centreOnSecondCard;
  setTimeout(centreOnSecondCard, 50);
}

/* ------------------------------------------------------------------ */
/* Confirm & preview overlay                                          */
/* ------------------------------------------------------------------ */

function registerPreviewOverlay() {
  const confirmBtn = qs('#confirm-game-btn');
  const overlay = qs('#video-overlay');
  const previewVid = qs('#game-video');
  const closeBtn = qs('#close-video');
  const cornerBtn = qs('#corner-progress');

  if (!confirmBtn || !overlay || !previewVid || !closeBtn || !cornerBtn) {
    console.error('Preview overlay elements missing:', {
      confirmBtn: !!confirmBtn,
      overlay: !!overlay,
      previewVid: !!previewVid,
      closeBtn: !!closeBtn,
      cornerBtn: !!cornerBtn
    });
    return;
  }

  function openOverlay() {
    const src = previewVid.getAttribute('data-src') || '/static/assets/video1.mp4';
    previewVid.src = src;
    overlay.style.display = 'block';
    cornerBtn.style.setProperty('--prog', '0%');
    cornerBtn.style.opacity = '0.5';
    cornerBtn.style.pointerEvents = 'none';
    cornerBtn.onclick = null;
    previewVid.currentTime = 0;
    previewVid.play().catch(err => console.error('Video play error:', err));
    if (!window.__initStarted) {
      window.__initStarted = true;
      window.__initReady = false;
      window.__initSuccess = false;
      runConnectionCheckAndStart(0, true);
    }
  }

  function closeOverlay() {
    overlay.style.display = 'none';
    previewVid.pause();
  }

  confirmBtn.addEventListener('click', openOverlay);
  closeBtn.addEventListener('click', closeOverlay);

  previewVid.addEventListener('timeupdate', () => {
    if (!previewVid.duration || isNaN(previewVid.duration)) return;
    const pct = Math.min(100, (previewVid.currentTime / previewVid.duration) * 100);
    cornerBtn.style.setProperty('--prog', `${pct}%`);
  });

  previewVid.addEventListener('ended', () => {
    cornerBtn.style.opacity = '1';
    cornerBtn.style.pointerEvents = 'auto';
    cornerBtn.style.setProperty('--prog', '100%');
    cornerBtn.addEventListener('click', proceedAfterPreview, { once: true });
  });

  function proceedAfterPreview() {
    closeOverlay();
    goToPage('page_initializing');
    (function waitReady() {
      if (!window.__initReady) {
        setTimeout(waitReady, 150);
        return;
      }
      showStoredInitResultsSequentially();
    })();
    (function maybeStart() {
      if (!window.__initReady) {
        setTimeout(maybeStart, 250);
        return;
      }
      if (!window.__initSuccess) {
        return;
      }
      setTimeout(async () => {
        try {
          await fetch('/write_rfid_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token_id: rfidTag })
          });
          const res = await fetch('/api/start_game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_number: selectedGameId || 1, level_number: 1 })
          });
          const data = await res.json();
          if (!data.success) {
            qs('#init-status').textContent = data.error || 'Failed to launch the game.';
            qs('#init-error').classList.remove('hidden');
            return;
          }
          qs('#init-status').textContent = 'Game started. Good luck!';
          checkGameDone();
        } catch (err) {
          console.error('Error starting game:', err);
          qs('#init-status').textContent = 'Unexpected error during start.';
          qs('#init-error').classList.remove('hidden');
        }
      }, 3000);
    })();
  }
}

/* ------------------------------------------------------------------ */
/* Rules Display                                                      */
/* ------------------------------------------------------------------ */

function updateConfirmPageRules() {
  const rulesIds = ['rules-1', 'rules-2', 'rules-3'];
  rulesIds.forEach(id => {
    const ruleSet = qs(`#${id}`);
    if (ruleSet) {
      ruleSet.classList.toggle('hidden', id !== `rules-${selectedGameId}`);
    } else {
      console.warn(`Rules element #${id} not found`);
    }
  });
}

function updateInitPageRules() {
  const rulesContainer = qs('#rules-dynamic');
  const rulesTitle = qs('#rules-title-dynamic');
  const rulesList = qs('#rules-list-dynamic');
  if (!rulesContainer || !rulesTitle || !rulesList) {
    console.error('Init page rules elements missing:', {
      rulesContainer: !!rulesContainer,
      rulesTitle: !!rulesTitle,
      rulesList: !!rulesList
    });
    return;
  }

  const rulesMap = {
    1: 'rules-1',
    2: 'rules-2',
    3: 'rules-3'
  };
  const sourceRulesId = rulesMap[selectedGameId] || 'rules-1';
  const sourceRulesDiv = qs(`#${sourceRulesId}`);
  if (!sourceRulesDiv) {
    console.error(`Source rules div #${sourceRulesId} not found`);
    return;
  }

  const sourceTitle = sourceRulesDiv.querySelector('.rules-title');
  const sourceListItems = sourceRulesDiv.querySelectorAll('.rules-list li');
  if (!sourceTitle || sourceListItems.length === 0) {
    console.error('Source rules title or items missing for:', sourceRulesId);
    return;
  }

  rulesTitle.innerHTML = sourceTitle.innerHTML;
  rulesList.innerHTML = '';
  sourceListItems.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.textContent;
    rulesList.appendChild(li);
  });

  rulesContainer.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* Initialisation sequence                                            */
/* ------------------------------------------------------------------ */

function clearSteps() {
  const host = qs('#init-steps');
  if (host) host.innerHTML = '';
}

function addStepRow(name) {
  const row = document.createElement('div');
  row.className = 'step hidden';
  row.innerHTML = `<span class="tick-mark">✔</span><span class="step-text">${name}</span>`;
  qs('#init-steps').appendChild(row);
  requestAnimationFrame(() => row.classList.add('show'));
  return row;
}

function markRow(row, ok, msg) {
  row.classList.toggle('ok', ok);
  row.classList.toggle('fail', !ok);
  if (msg) {
    const m = document.createElement('div');
    m.className = 'step-message';
    m.textContent = msg;
    row.appendChild(m);
  }
}

async function runConnectionCheckAndStart(delayStartMs = 0, skipStart = false) {
  try {
    clearSteps();
    const errBox = qs('#init-error');
    if (errBox) errBox.classList.add('hidden');
    qs('#init-status').textContent = 'Running connection checks...';
    const res = await fetch('/api/connection_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_number: selectedGameId || 1 })
    });
    const data = await res.json();
    const base = ['Joystick/Gesture', 'Nodes', 'Car', 'Drone'];
    const order = (selectedGameId === 2) ? base : base.filter(n => n !== 'Car');
    const results = [];
    for (const name of order) {
      const step = (data.steps || []).find(s => s.name === name);
      if (!step) continue;
      let label = name === 'Joystick/Gesture' ? (controllerMode === 'joystick' ? 'Joystick Controller' : 'Hand Gesture Controller') : step.name;
      results.push({ displayName: label, ok: !!step.ok, message: step.message || '' });
      if (!skipStart) {
        const row = addStepRow(label);
        await new Promise(r => setTimeout(r, 200));
        markRow(row, !!step.ok, step.message || '');
      }
    }
    window.__initStoredResults = { results: results, success: !!data.success };
    window.__initReady = true;
    window.__initSuccess = !!data.success;
    if (skipStart) return;
    if (!data.success) {
      qs('#init-status').textContent = 'Initialisation failed.';
      qs('#init-error').classList.remove('hidden');
      return;
    }
    qs('#init-status').textContent = 'Connection OK. Preparing game...';
    if (delayStartMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayStartMs));
    }
    try {
      await fetch('/write_rfid_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_id: rfidTag })
      });
      const startRes = await fetch('/api/start_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_number: selectedGameId || 1, level_number: 1 })
      });
      const startData = await startRes.json();
      if (!startData.success) {
        qs('#init-status').textContent = startData.error || 'Failed to launch the game.';
        qs('#init-error').classList.remove('hidden');
        return;
      }
      qs('#init-status').textContent = 'Game started. Good luck!';
      checkGameDone();
    } catch (err) {
      console.error('Error starting game:', err);
      qs('#init-status').textContent = 'Unexpected error during start.';
      qs('#init-error').classList.remove('hidden');
    }
  } catch (e) {
    console.error('Init/start error:', e);
    qs('#init-status').textContent = 'Unexpected error during initialisation.';
    qs('#init-error').classList.remove('hidden');
  }
}

function showStoredInitResultsSequentially() {
  const stored = window.__initStoredResults;
  if (!stored || !stored.results) return;
  clearSteps();
  const errBox = qs('#init-error');
  if (errBox) errBox.classList.add('hidden');
  qs('#init-status').textContent = 'Running connection checks...';
  const steps = stored.results;
  let idx = 0;
  function displayNext() {
    if (idx < steps.length) {
      const step = steps[idx++];
      const row = addStepRow(step.displayName);
      setTimeout(() => {
        markRow(row, step.ok, step.message);
        setTimeout(displayNext, 200);
      }, 200);
    } else {
      if (!stored.success) {
        qs('#init-status').textContent = 'Initialisation failed.';
        qs('#init-error').classList.remove('hidden');
      } else {
        qs('#init-status').textContent = 'Connection OK. Preparing game...';
      }
    }
  }
  displayNext();
}

function retryConnectionCheck() {
  const errBox = qs('#init-error');
  if (errBox) errBox.classList.add('hidden');
  window.__initStarted = false;
  window.__initReady = false;
  window.__initSuccess = false;
  runConnectionCheckAndStart(3000, false);
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                        */
/* ------------------------------------------------------------------ */

function checkGameDone() {
  const intv = setInterval(() => {
    fetch('/game_done')
      .then(r => r.json())
      .then(d => {
        if (d.done) {
          clearInterval(intv);
          showLeaderboard();
        }
      })
      .catch(err => {
        clearInterval(intv);
      });
  }, 1500);
}

function showLeaderboard() {
  goToPage('page16');
  const tbody = qs('#leaderboard-body');
  if (!tbody) return;
  ['first', 'second', 'third'].forEach(cls => {
    const pod = qs('.pod.' + cls);
    if (pod) {
      const nameEl = pod.querySelector('.pod-name');
      const scoreEl = pod.querySelector('.pod-score');
      if (nameEl) nameEl.textContent = '';
      if (scoreEl) scoreEl.textContent = '';
    }
  });
  tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
  fetch('/get_leaderboard')
    .then(r => r.json())
    .then(data => {
      const players = (data && data.leaderboard) ? data.leaderboard : [];
      const podium = [players[0], players[1], players[2]];
      ['first', 'second', 'third'].forEach((cls, idx) => {
        const pod = qs('.pod.' + cls);
        const player = podium[idx];
        if (pod) {
          const nameEl = pod.querySelector('.pod-name');
          const scoreEl = pod.querySelector('.pod-score');
          if (nameEl) nameEl.textContent = player ? player.name : '';
          if (scoreEl) scoreEl.textContent = player ? player.score : '';
        }
      });
      if (players.length <= 3) {
        tbody.innerHTML = '<tr><td colspan="3">All players are on the podium!</td></tr>';
        return;
      }
      tbody.innerHTML = players.slice(3).map((p, i) =>
        `<tr><td>${i + 4}</td><td>${p.name}</td><td>${p.score}</td></tr>`
      ).join('');
    })
    .catch(err => {
      tbody.innerHTML = '<tr><td colspan="3">Error loading leaderboard.</td></tr>';
    });
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

window.onload = function() {
  console.log('Window loaded, initializing components');
  registerControllerToggle();
  beginAutoScan();
  initializeCardSlider('#game-card-container');
  registerPreviewOverlay();
};

// Expose functions for inline HTML
window.goToPage = goToPage;
window.confirmPlayer = confirmPlayer;
window.retryConnectionCheck = retryConnectionCheck;
window.backToChoose = backToChoose;
window.backToHome = function() {
  goToPage('page1');
  if (scanInterval) clearInterval(scanInterval);
  scanningActive = true;
  beginAutoScan();
};