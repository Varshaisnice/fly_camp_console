
// FlyCamp – base functionality with improved initialisation sequence

/*
 * This script drives the FlyCamp console app. It provides:
 *   - RFID scanning on the welcome screen
 *   - A game-selection slider where only the focused card plays its video
 *   - A confirm page with a preview video overlay and progress bar
 *   - An initialising page that animates connection checks sequentially
 *   - Leaderboard display
 *
 * The only change from the original behaviour is how initialisation is handled:
 * connection checks are run in the background while the user watches the preview
 * video, but the results are not drawn until the user proceeds. When the results
 * are displayed, they appear step-by-step with a short delay between them.
 * If the checks succeed, the game is started 3 seconds after all results have
 * been drawn; otherwise the user sees an error and may retry.
 */

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

/**
 * Show a page by its ID and hide all others. Also reset the body
 * background colour to the default blue (no dynamic colour changes).
 * When returning to the game-selection page, recenter the slider on
 * Hue’s the Boss (the second card).
 *
 * @param {string} id The ID of the page (e.g. 'page1', 'page_choose_game').
 */
function goToPage(id){
  // Hide all screens
  qsa('.screen').forEach(s => s.classList.remove('active'));
  // Show the requested page
  const pageEl = qs(`#${id}`);
  if (pageEl) pageEl.classList.add('active');
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
function backToChoose(){
  goToPage('page_choose_game');
}

/* ------------------------------------------------------------------ */
/* Controller toggle (Joystick vs Hand Gesture)                       */
/* ------------------------------------------------------------------ */

/**
 * Replace occurrences of the controller labels throughout visible text.
 * This uses a TreeWalker to find text nodes that contain either of the
 * labels (case-insensitive) and replaces them accordingly.
 */
function updateControllerLabels(){
  const root = document.body;
  const toWord   = (controllerMode === 'joystick') ? WORD_A : WORD_B;
  const fromWord = (controllerMode === 'joystick') ? WORD_B : WORD_A;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      const txt = node.nodeValue;
      if (!txt) return NodeFilter.FILTER_SKIP;
      const lower = txt.toLowerCase();
      if (lower.includes(WORD_A.toLowerCase()) ||
          lower.includes(WORD_B.toLowerCase())) {
        // Only replace text in visible elements
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
    // Normalise both labels first (to avoid case mismatches)
    t = t.replace(new RegExp(WORD_A, 'ig'), WORD_A);
    t = t.replace(new RegExp(WORD_B, 'ig'), WORD_B);
    // Then replace whichever one is currently inactive with the target label
    t = t.replace(new RegExp(fromWord, 'ig'), toWord);
    node.nodeValue = t;
  });
}

/** Toggle the controller mode and update labels. */
function registerControllerToggle(){
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

/**
 * Begin automatically scanning for an RFID token every 5 seconds. Once
 * a token is detected, greeting info is shown and the user is taken to
 * the confirmation page (page2). Scanning continues until the user
 * confirms their token.
 */
function beginAutoScan(){
  const loader = qs('#loader1');
  if (loader) loader.textContent = 'Waiting for token...';
  scanInterval = setInterval(() => {
    if (!scanningActive) return;
    fetch('/scan_rfid')
      .then(r => r.json())
      .then(d => {
        if (d.success){
          username = d.name;
          rfidTag  = d.token_id;
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

/** Stop scanning and go to the choose-game page. */
function confirmPlayer(){
  scanningActive = false;
  if (scanInterval) clearInterval(scanInterval);
  goToPage('page_choose_game');
}

/* ------------------------------------------------------------------ */
/* Game selection slider                                              */
/* ------------------------------------------------------------------ */

/**
 * Initialise the horizontal slider of game cards. Only the card in
 * focus plays its video. Cards snap to the centre on swipe. On load
 * and when returning to this page, the slider recentres on Hue’s the
 * Boss (the second card).
 *
 * @param {string} selector The CSS selector for the card container
 */
function initializeCardSlider(selector){
  const slider = qs(selector);
  if (!slider) return;
  const cards = qsa('.card', slider);

  // Pause all videos so only one plays at a time
  cards.forEach(card => {
    const vid = card.querySelector('.card-video');
    if (vid){
      vid.pause();
      vid.currentTime = 0;
    }
  });

  /** Mark the card closest to the centre as active and play its video. */
  function updateActiveCard(){
    const centre = slider.scrollLeft + slider.clientWidth / 2;
    let closest = null;
    let minDist = Infinity;
    cards.forEach(card => {
      const cc = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cc - centre);
      if (dist < minDist){
        minDist = dist;
        closest = card;
      }
    });
    cards.forEach(card => {
      const vid = card.querySelector('.card-video');
      if (card === closest){
        card.classList.add('is-active');
        if (vid) vid.play().catch(() => {});
      } else {
        card.classList.remove('is-active');
        if (vid){
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
  cards.forEach(card => {
    card.addEventListener('click', () => {
      selectedGameId    = parseInt(card.getAttribute('data-game-id'), 10);
      selectedGameTitle = card.getAttribute('data-title') || '';
      selectedGameDesc  = card.getAttribute('data-desc')  || '';
      qs('#chosen-game-title').textContent = `You chose: ${selectedGameTitle}`;
      qs('#chosen-game-desc').textContent  = selectedGameDesc;
      const src = card.getAttribute('data-video') || '/static/assets/video1.mp4';
      qs('#game-video').setAttribute('data-src', src);
      goToPage('page_confirm');
      // Reset initialisation state for this game selection
      window.__initStarted = false;
      window.__initReady   = false;
      window.__initSuccess = false;
    });
  });

  /** Centre the slider on the second card (Hue’s the Boss). */
  function centreOnSecondCard(){
    const second = cards[1];
    if (!second) return;
    const offset = second.offsetLeft - (slider.clientWidth / 2) + (second.clientWidth / 2);
    slider.scrollLeft = offset;
    updateActiveCard();
  }

  // Expose method so goToPage can recenter when returning to this page
  slider.centerOnSecondCard = centreOnSecondCard;
  // Recenter shortly after page load
  setTimeout(centreOnSecondCard, 50);
}

/* ------------------------------------------------------------------ */
/* Confirm & preview overlay                                          */
/* ------------------------------------------------------------------ */

/**
 * Register the video preview overlay on the confirm page. When the user
 * clicks the Confirm Game button, the preview video plays with a small
 * progress bar. During this time the connection checks are started in
 * the background (with skipStart=true), so results will be ready by the
 * time the user proceeds.
 *
 * After the video ends, the progress bar becomes active. Clicking it
 * hides the overlay, shows the initialising page and animates the
 * stored results. If the checks succeeded, the game will start 3
 * seconds after the results are displayed; otherwise the user sees an
 * error and can retry.
 */
function registerPreviewOverlay(){
  const confirmBtn = qs('#confirm-game-btn');
  const overlay    = qs('#video-overlay');
  const previewVid = qs('#game-video');
  const closeBtn   = qs('#close-video');
  const cornerBtn  = qs('#corner-progress');

  if (!confirmBtn || !overlay || !previewVid || !closeBtn || !cornerBtn) return;

  /** Open the overlay and start playing the preview video. */
  function openOverlay(){
    const src = previewVid.getAttribute('data-src') || '/static/assets/video1.mp4';
    previewVid.src = src;
    overlay.style.display = 'block';
    // Reset progress bar & disable until video ends
    cornerBtn.style.setProperty('--prog', '0%');
    cornerBtn.style.opacity = '0.5';
    cornerBtn.style.pointerEvents = 'none';
    cornerBtn.onclick = null;
    previewVid.currentTime = 0;
    previewVid.play().catch(() => {});
    // Start running connection checks in the background (skipStart=true)
    if (!window.__initStarted){
      window.__initStarted = true;
      window.__initReady   = false;
      window.__initSuccess = false;
      runConnectionCheckAndStart(0, true);
    }
  }

  /** Close the overlay and pause the preview video. */
  function closeOverlay(){
    overlay.style.display = 'none';
    previewVid.pause();
  }

  confirmBtn.addEventListener('click', openOverlay);
  closeBtn.addEventListener('click', closeOverlay);

  // Update the progress bar as the video plays
  previewVid.addEventListener('timeupdate', () => {
    if (!previewVid.duration || isNaN(previewVid.duration)) return;
    const pct = Math.min(100, (previewVid.currentTime / previewVid.duration) * 100);
    cornerBtn.style.setProperty('--prog', `${pct}%`);
  });

  // When the video finishes, enable the button
  previewVid.addEventListener('ended', () => {
    cornerBtn.style.opacity = '1';
    cornerBtn.style.pointerEvents = 'auto';
    cornerBtn.style.setProperty('--prog', '100%');
    cornerBtn.addEventListener('click', proceedAfterPreview, { once: true });
  });

  /**
   * Proceed after the preview video: hide overlay, show init page,
   * animate stored results sequentially, then start the game after a 3s delay
   * (if checks succeeded).
   */
  function proceedAfterPreview(){
    closeOverlay();
    goToPage('page_initializing');
    // Wait until results are ready, then animate them
    (function waitReady(){
      if (!window.__initReady){
        setTimeout(waitReady, 150);
        return;
      }
      showStoredInitResultsSequentially();
    })();
    // Once ready, wait 3s then start game if successful
    (function maybeStart(){
      if (!window.__initReady){
        setTimeout(maybeStart, 250);
        return;
      }
      if (!window.__initSuccess){
        // Show error if checks failed (the animation will handle this)
        return;
      }
      setTimeout(async () => {
        try {
          await fetch('/write_rfid_token', {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ token_id: rfidTag })
          });
          const res  = await fetch('/api/start_game', {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ game_number: selectedGameId || 1, level_number: 1 })
          });
          const data = await res.json();
          if (!data.success){
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

/**
 * Update the rules display on the confirm page based on selectedGameId.
 */
function updateConfirmPageRules(){
  const rulesIds = ['rules-1', 'rules-2', 'rules-3'];
  rulesIds.forEach(id => {
    const ruleSet = qs(`#${id}`);
    if (ruleSet) {
      ruleSet.classList.toggle('hidden', id !== `rules-${selectedGameId}`);
    }
  });
}

/**
 * Update the rules display on the initializing page based on selectedGameId.
 */
function updateInitPageRules(){
  const rulesContainer = qs('#rules-dynamic');
  const rulesTitle = qs('#rules-title-dynamic');
  const rulesList = qs('#rules-list-dynamic');
  if (!rulesContainer || !rulesTitle || !rulesList) return;

  // Map selectedGameId to rules div ID
  const rulesMap = {
    1: 'rules-1', // Hover & Seek
    2: 'rules-2', // Hue’s the Boss
    3: 'rules-3'  // Color Chaos
  };
  const sourceRulesId = rulesMap[selectedGameId] || 'rules-1';
  const sourceRulesDiv = qs(`#${sourceRulesId}`);
  if (!sourceRulesDiv) return;

  // Copy title and list items
  const sourceTitle = sourceRulesDiv.querySelector('.rules-title').innerHTML;
  const sourceListItems = sourceRulesDiv.querySelectorAll('.rules-list li');
  rulesTitle.innerHTML = sourceTitle;
  rulesList.innerHTML = '';
  sourceListItems.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.textContent;
    rulesList.appendChild(li);
  });

  // Show the rules container
  rulesContainer.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* Initialisation sequence                                            */
/* ------------------------------------------------------------------ */

/**
 * Clear the list of steps in the initialising page.
 */
function clearSteps(){
  const host = qs('#init-steps');
  if (host) host.innerHTML = '';
}

/**
 * Create and append a step row to the step list. The row is hidden
 * until .show is added via animation timing.
 *
 * @param {string} name The label of the step
 * @returns {HTMLElement} The created row
 */
function addStepRow(name){
  const row = document.createElement('div');
  row.className = 'step hidden';
  row.innerHTML = `<span class="tick-mark">✔</span><span class="step-text">${name}</span>`;
  qs('#init-steps').appendChild(row);
  // Animate into view on the next frame
  requestAnimationFrame(() => row.classList.add('show'));
  return row;
}

/**
 * Mark a step row as either OK or Failed and optionally show a message.
 *
 * @param {HTMLElement} row The row element
 * @param {boolean} ok Whether the step succeeded
 * @param {string} msg Optional additional message
 */
function markRow(row, ok, msg){
  row.classList.toggle('ok', ok);
  row.classList.toggle('fail', !ok);
  if (msg){
    const m = document.createElement('div');
    m.className = 'step-message';
    m.textContent = msg;
    row.appendChild(m);
  }
}

/**
 * Run connection checks for the selected game. Results are either
 * displayed immediately (if skipStart=false) or stored for later
 * sequential animation (if skipStart=true). When skipStart=false, the
 * game may optionally start after a delay.
 *
 * @param {number} delayStartMs Delay before starting the game (only
 *        used when skipStart=false and checks succeed)
 * @param {boolean} skipStart If true, do not display steps or start the game
 */
async function runConnectionCheckAndStart(delayStartMs = 0, skipStart = false){
  try {
    // Reset UI for new run
    clearSteps();
    const errBox = qs('#init-error');
    if (errBox) errBox.classList.add('hidden');
    qs('#init-status').textContent = 'Running connection checks...';
    // Call server to perform checks
    const res  = await fetch('/api/connection_check', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ game_number: selectedGameId || 1 })
    });
    const data = await res.json();
    // Determine the display order of steps
    const base = ['Joystick/Gesture', 'Nodes', 'Car', 'Drone'];
    const order = (selectedGameId === 2) ? base : base.filter(n => n !== 'Car');
    // Prepare results array and optionally animate each step
    const results = [];
    for (const name of order){
      const step = (data.steps || []).find(s => s.name === name);
      if (!step) continue;
      // Determine user-facing name
      let label;
      if (name === 'Joystick/Gesture'){
        label = (controllerMode === 'joystick') ? 'Joystick Controller' : 'Hand Gesture Controller';
      } else {
        label = step.name;
      }
      // Store result
      results.push({ displayName: label, ok: !!step.ok, message: step.message || '' });
      // If not skipping start, animate step row now
      if (!skipStart){
        const row = addStepRow(label);
        await new Promise(r => setTimeout(r, 200));
        markRow(row, !!step.ok, step.message || '');
      }
    }
    // Save results for later sequential animation
    window.__initStoredResults = { results: results, success: !!data.success };
    window.__initReady   = true;
    window.__initSuccess = !!data.success;
    // If skipping start, we don't display final status or start game now
    if (skipStart){
      return;
    }
    // Update status and error state for immediate display
    if (!data.success){
      qs('#init-status').textContent = 'Initialisation failed.';
      qs('#init-error').classList.remove('hidden');
      return;
    }
    qs('#init-status').textContent = 'Connection OK. Preparing game...';
    // Wait for delayStartMs then start the game
    if (delayStartMs > 0){
      await new Promise(resolve => setTimeout(resolve, delayStartMs));
    }
    try {
      await fetch('/write_rfid_token', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ token_id: rfidTag })
      });
      const startRes  = await fetch('/api/start_game', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ game_number: selectedGameId || 1, level_number: 1 })
      });
      const startData = await startRes.json();
      if (!startData.success){
        qs('#init-status').textContent = startData.error || 'Failed to launch the game.';
        qs('#init-error').classList.remove('hidden');
        return;
      }
      qs('#init-status').textContent = 'Game started. Good luck!';
      checkGameDone();
    } catch (err) {
      console.error('Unexpected error during start:', err);
      qs('#init-status').textContent = 'Unexpected error during start.';
      qs('#init-error').classList.remove('hidden');
    }
  } catch (e){
    console.error('Init/start error:', e);
    qs('#init-status').textContent = 'Unexpected error during initialisation.';
    qs('#init-error').classList.remove('hidden');
  }
}

/**
 * Replay stored connection check results sequentially. This is called
 * when the user enters the initialising page after the preview video.
 * It clears any existing steps, hides the error banner, and animates
 * each result with a short delay. Once complete, the status text is
 * updated and the error banner is shown if checks failed.
 */
function showStoredInitResultsSequentially(){
  const stored = window.__initStoredResults;
  if (!stored || !stored.results) return;
  clearSteps();
  const errBox = qs('#init-error');
  if (errBox) errBox.classList.add('hidden');
  // Reset status before animating
  qs('#init-status').textContent = 'Running connection checks...';
  const steps = stored.results;
  let idx = 0;
  function displayNext(){
    if (idx < steps.length){
      const step = steps[idx++];
      const row  = addStepRow(step.displayName);
      setTimeout(() => {
        markRow(row, step.ok, step.message);
        setTimeout(displayNext, 200);
      }, 200);
    } else {
      // After animating all results
      if (!stored.success){
        qs('#init-status').textContent = 'Initialisation failed.';
        qs('#init-error').classList.remove('hidden');
      } else {
        qs('#init-status').textContent = 'Connection OK. Preparing game...';
      }
    }
  }
  displayNext();
}

/** Retry connection checks (e.g. after a failure). */
function retryConnectionCheck(){
  const errBox = qs('#init-error');
  if (errBox) errBox.classList.add('hidden');
  window.__initStarted = false;
  window.__initReady   = false;
  window.__initSuccess = false;
  // On retry we run checks, then wait 3 seconds before auto-starting if ok
  runConnectionCheckAndStart(3000, false);
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                        */
/* ------------------------------------------------------------------ */

/**
 * Poll the server until the game signals completion, then show the
 * leaderboard screen.
 */
function checkGameDone(){
  const intv = setInterval(() => {
    fetch('/game_done')
      .then(r => r.json())
      .then(d => {
        if (d.done){
          clearInterval(intv);
          showLeaderboard();
        }
      })
      .catch(err => {
        clearInterval(intv);
      });
  }, 1500);
}

/**
 * Render the leaderboard. Clears any prior content, shows a loading
 * message while fetching, then populates the podium and table. If the
 * fetch fails, an error message is displayed.
 */
function showLeaderboard(){
  goToPage('page16');
  const tbody = qs('#leaderboard-body');
  if (!tbody) return;
  // Reset podium names and scores
  ['first','second','third'].forEach(cls => {
    const pod = qs('.pod.' + cls);
    if (pod){
      const nameEl  = pod.querySelector('.pod-name');
      const scoreEl = pod.querySelector('.pod-score');
      if (nameEl)  nameEl.textContent  = '';
      if (scoreEl) scoreEl.textContent = '';
    }
  });
  // Show loading row
  tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
  // Fetch leaderboard
  fetch('/get_leaderboard')
    .then(r => r.json())
    .then(data => {
      const players = (data && data.leaderboard) ? data.leaderboard : [];
      const podium  = [players[0], players[1], players[2]];
      // Update podium
      ['first','second','third'].forEach((cls, idx) => {
        const pod   = qs('.pod.' + cls);
        const player = podium[idx];
        if (pod){
          const nameEl  = pod.querySelector('.pod-name');
          const scoreEl = pod.querySelector('.pod-score');
          if (nameEl)  nameEl.textContent  = player ? player.name  : '';
          if (scoreEl) scoreEl.textContent = player ? player.score : '';
        }
      });
      // Populate table
      if (players.length <= 3){
        tbody.innerHTML = '<tr><td colspan="3">All players are on the podium!</td></tr>';
        return;
      }
      tbody.innerHTML = players.slice(3).map((p,i) =>
        `<tr><td>${i+4}</td><td>${p.name}</td><td>${p.score}</td></tr>`
      ).join('');
    })
    .catch(err => {
      tbody.innerHTML = '<tr><td colspan="3">Error loading leaderboard.</td></tr>';
    });
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

/**
 * On window load, set up scanning, controller toggle, card slider and
 * preview overlay.
 */
window.onload = function(){
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
window.backToHome  = function(){
  // Return to page1 and restart scanning
  goToPage('page1');
  if (scanInterval) clearInterval(scanInterval);
  scanningActive = true;
  beginAutoScan();
};

