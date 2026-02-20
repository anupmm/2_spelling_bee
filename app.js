import * as piperModule from 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.0/+esm';

const STORAGE_KEY = "spelling_bee_app_state";
const SCHEMA_VERSION = 1;

const STEPS = {
  IDLE: "idle",
  SPOKEN_WAIT_CHOICE: "spoken_wait_choice",
  REVEALED_NEEDS_SCORE: "revealed_needs_score",
  // SCORED_READY_NEXT removed, we auto-advance
};

const runtime = {
  words: [],
  wordById: new Map(),
  filteredWordIds: [],
  currentWordId: null,
  currentStep: STEPS.IDLE,
  currentPath: null,
  lastWordId: null,
  activeTab: "practice",
  hasAppliedFilters: false,
  ttsEngine: "piper", // "piper" or "browser"
  piperInstance: null,
};

let storageReadOnly = false;
let store = defaultStore();

const ui = {};

document.addEventListener("DOMContentLoaded", () => {
  store = loadStore();
  cacheUi();
  bindEvents();
  initVoices();
  initializeApp();
});

function cacheUi() {
  ui.statusMessage = document.getElementById("statusMessage");
  ui.tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  ui.tabPanels = {
    filters: document.getElementById("tab-filters"),
    practice: document.getElementById("tab-practice"),
    score: document.getElementById("tab-score"),
    history: document.getElementById("tab-history"),
  };
  ui.filtersDetails = document.getElementById("filtersDetails");
  ui.activeFilterSummary = document.getElementById("activeFilterSummary");

  ui.yearFilter = document.getElementById("yearFilter");
  ui.levelFilter = document.getElementById("levelFilter");
  ui.ttsEngineSelect = document.getElementById("ttsEngineSelect");
  ui.voiceSelect = document.getElementById("voiceSelect");
  ui.testVoiceBtn = document.getElementById("testVoiceBtn");
  ui.applyFiltersBtn = document.getElementById("applyFiltersBtn");
  ui.resetFilterProgressBtn = document.getElementById("resetFilterProgressBtn");

  ui.wordMeta = document.getElementById("wordMeta");
  ui.revealSpelling = document.getElementById("revealSpelling");
  ui.revealBtn = document.getElementById("revealBtn");

  ui.playBtn = document.getElementById("playBtn");
  ui.slowBtn = document.getElementById("slowBtn");

  // ui.startBtn removed

  ui.forgotBtn = document.getElementById("forgotBtn");
  ui.wrongBtn = document.getElementById("wrongBtn");
  ui.hearBtn = document.getElementById("hearBtn");
  ui.correctBtn = document.getElementById("correctBtn");

  ui.stageNext = document.getElementById("stageNext"); // Kept just to ensure no null ref errors, though hidden

  // ui.stageStart = document.getElementById("stageStart"); // Removed
  ui.stageListen = document.getElementById("stageListen");
  ui.stageScore = document.getElementById("stageScore");
  ui.stageNext = document.getElementById("stageNext");

  ui.attemptCount = document.getElementById("attemptCount");
  ui.accuracyStat = document.getElementById("accuracyStat");
  ui.missedCount = document.getElementById("missedCount");
  ui.remainingCount = document.getElementById("remainingCount");

  ui.historyFilter = document.getElementById("historyFilter");
  ui.historyContent = document.getElementById("historyContent");
  ui.hideSpellingsToggle = document.getElementById("hideSpellingsToggle");
}

function bindEvents() {
  ui.tabButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  ui.applyFiltersBtn.addEventListener("click", applyFilters);
  ui.resetFilterProgressBtn.addEventListener("click", resetFilterProgress);
  ui.ttsEngineSelect.addEventListener("change", (e) => {
    runtime.ttsEngine = e.target.value;
    refreshVoiceList();
  });
  ui.testVoiceBtn.addEventListener("click", testSelectedVoice);

  // Play button repeats if already conducting word
  // Play button repeats if already conducting word
  ui.playBtn.addEventListener("click", () => speakCurrentWord(1));
  ui.slowBtn.addEventListener("click", () => speakCurrentWord(0.2));

  // ui.startBtn removed

  ui.revealBtn.addEventListener("click", onReveal);

  ui.forgotBtn.addEventListener("click", () => scoreCurrentWord("incorrect"));
  ui.wrongBtn.addEventListener("click", () => scoreCurrentWord("incorrect"));
  ui.hearBtn.addEventListener("click", () => scoreCurrentWord("incorrect"));
  ui.correctBtn.addEventListener("click", () => scoreCurrentWord("correct"));

  if (ui.hideSpellingsToggle) {
    ui.hideSpellingsToggle.addEventListener("change", (e) => {
      if (ui.historyContent) {
        if (e.target.checked) {
          ui.historyContent.classList.add("hidden-spelling");
        } else {
          ui.historyContent.classList.remove("hidden-spelling");
        }
      }
    });
  }
}

async function initializeApp() {
  setActiveTab("practice");

  if (window.location.protocol === "file:") {
    setStatus("Open http://localhost:8000 (not file://) so the CSV can load.", "error");
    return;
  }

  try {
    const csvText = await fetchWordCsv();
    const parsedWords = parseWordCsv(csvText);
    runtime.words = parsedWords;
    runtime.wordById = new Map(parsedWords.map((word) => [word.id, word]));

    initializeFilters(parsedWords);
    applyFilters({ collapseFilters: false, switchToPractice: false });
    renderStats();
    renderHistory();

    if (storageReadOnly) {
      setStatus("Loaded read-only due to newer saved schema. Clear browser storage to save new progress.", "error");
    } else {
      setStatus("Ready. Use Practice tab to begin.");
    }
  } catch (error) {
    setStatus("Could not load curated_word_list.csv. Run this folder via a local web server.", "error");
    console.error(error);
  }
}

function setActiveTab(tabName) {
  runtime.activeTab = tabName;

  ui.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });

  Object.entries(ui.tabPanels).forEach(([name, panel]) => {
    panel.classList.toggle("is-active", name === tabName);
  });
}

async function fetchWordCsv() {
  const response = await fetch("curated_word_list.csv", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load CSV (${response.status}).`);
  }
  return response.text();
}

function parseWordCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    throw new Error("CSV has no data rows.");
  }

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  const yearIndex = headers.indexOf("Year");
  const levelIndex = headers.indexOf("Level");
  const wordsIndex = headers.indexOf("Words");

  if (yearIndex === -1 || levelIndex === -1 || wordsIndex === -1) {
    throw new Error("CSV must contain Year, Level, and Words columns.");
  }

  const words = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const year = (row[yearIndex] || "").trim();
    const level = (row[levelIndex] || "").trim();
    const rawWords = (row[wordsIndex] || "").trim();
    if (!year || !level || !rawWords) {
      continue;
    }

    const variants = rawWords
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!variants.length) {
      continue;
    }

    const id = words.length + 1;
    words.push({
      id,
      year,
      level,
      rawWords,
      variants,
      displaySpelling: variants[0],
    });
  }

  return words;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some((cell) => (cell || "").trim() !== ""));
}

function initializeFilters(words) {
  const years = [...new Set(words.map((word) => word.year))].sort();
  const levels = [...new Set(words.map((word) => word.level))].sort();

  fillSelect(ui.yearFilter, ["All", ...years]);
  fillSelect(ui.levelFilter, ["All", ...levels]);
}

function fillSelect(select, values) {
  select.innerHTML = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
}

function applyFilters(options = {}) {
  const { collapseFilters = true, switchToPractice = true } = options;
  const year = ui.yearFilter.value;
  const level = ui.levelFilter.value;

  runtime.filteredWordIds = runtime.words
    .filter((word) => (year === "All" || word.year === year) && (level === "All" || word.level === level))
    .map((word) => word.id);

  runtime.hasAppliedFilters = true;
  updateFilterSummary();

  if (runtime.filteredWordIds.length > 0) {
    // Auto-start
    setStatus(`Filter ready with ${runtime.filteredWordIds.length} words. Starting...`);
    // Small delay to let UI settle
    setTimeout(() => {
      if (switchToPractice || runtime.activeTab === 'practice') {
        nextWord();
      } else {
        setIdleState();
      }
    }, 100);
  } else {
    setIdleState();
    setStatus("No words in this filter. Change filters.");
  }

  renderStats();
}

function updateFilterSummary() {
  const year = ui.yearFilter.value || "All";
  const level = ui.levelFilter.value || "All";
  ui.activeFilterSummary.textContent = `Active: Year ${year}, Level ${level}`;
}

function nextWord() {
  if (runtime.currentStep !== STEPS.IDLE && runtime.currentStep !== STEPS.REVEALED_NEEDS_SCORE) {
    // allow restart or next from scored state if we had one
  }

  if (!runtime.filteredWordIds.length) {
    setStatus("No words available for this filter.", "error");
    return;
  }

  const candidate = pickNextWord();
  if (!candidate) {
    setStatus("All words for this filter are completed. Reset progress or change filters.");
    setIdleState();
    renderStats();
    return;
  }

  runtime.currentWordId = candidate.id;
  runtime.currentStep = STEPS.SPOKEN_WAIT_CHOICE;
  // Clear reveals
  ui.revealSpelling.textContent = "";

  speakCurrentWord(1);
  setStatus("Listen. Tap Reveal when ready.");
  setActiveTab("practice");
  renderUiState();
}

function pickNextWord() {
  const filterKey = getCurrentFilterKey();
  const askedIds = getAskedIds(filterKey);
  const askedSet = new Set(askedIds);
  const remediationQueue = getRemediationQueue(filterKey);

  // 1. Identify words that are in the review queue (meaning they need remediation)
  // We exclude the very last word asked to avoid immediate repetition
  const availableForReview = remediationQueue.filter(
    (item) => item.wordId !== runtime.lastWordId
  );

  // 2. Identify brand novel words that have never been asked
  const unseen = runtime.filteredWordIds.filter(
    (id) => !askedSet.has(id) && id !== runtime.lastWordId
  );

  // 3. Decide whether to ask a New Word or Review Word based on a 90/10 split
  // If there are words to review AND new words available:
  if (availableForReview.length > 0 && unseen.length > 0) {
    const roll = Math.random();
    if (roll < 0.10) {
      // 10% chance to review
      const chosen = pickRandom(availableForReview);
      return { id: chosen.wordId };
    } else {
      // 90% chance for a new word
      const chosenId = pickRandom(unseen);
      askedSet.add(chosenId);
      store.askedHistoryByFilterKey[filterKey] = Array.from(askedSet);
      saveStore();
      return { id: chosenId };
    }
  }

  // 4. Fallbacks if one of the pools is empty
  if (unseen.length > 0) {
    // Only new words available (or review queue was empty)
    const chosenId = pickRandom(unseen);
    askedSet.add(chosenId);
    store.askedHistoryByFilterKey[filterKey] = Array.from(askedSet);
    saveStore();
    return { id: chosenId };
  }

  if (availableForReview.length > 0) {
    // Only review words available (we finished the new words list)
    const chosen = pickRandom(availableForReview);
    return { id: chosen.wordId };
  }

  // 5. If absolutely nothing else, we might be forced to repeat the last word, 
  // or the list is completely done.
  const anyRemediation = remediationQueue;
  if (anyRemediation.length > 0) {
    const chosen = pickRandom(anyRemediation);
    return { id: chosen.wordId };
  }

  return null;
}

function onReveal() {
  if (runtime.currentStep !== STEPS.SPOKEN_WAIT_CHOICE) return;

  runtime.currentStep = STEPS.REVEALED_NEEDS_SCORE;

  // Show spelling immediately
  renderRevealText();

  setStatus("Rate your spelling.");
  renderUiState();
}

function scoreCurrentWord(result) {
  if (runtime.currentStep !== STEPS.REVEALED_NEEDS_SCORE) return;
  finalizeAttempt(result);
}

function finalizeAttempt(result) {
  const word = getCurrentWord();
  if (!word) return;

  // "forgot" and "wrong" are both counted as incorrect for stats/remediation
  const isCorrect = result === "correct";
  const logResult = isCorrect ? "correct" : "incorrect";
  const detailPath = result; // "correct", "wrong", or "forgot"

  if (!isCorrect) {
    scheduleRemediation(word.id);
  } else {
    // If they got it right, log a successful attempt in the review queue
    handleCorrectReview(word.id);
  }

  // Ensure lastWordId is updated so we don't repeat immediately
  runtime.lastWordId = word.id;

  const attempt = {
    attemptId: createAttemptId(),
    timestamp: new Date().toISOString(),
    wordId: word.id,
    year: word.year,
    level: word.level,
    displaySpelling: word.displaySpelling,
    allVariants: word.variants.slice(),
    result: logResult,
    path: detailPath,
  };

  store.practiceLog.push(attempt);
  if (store.practiceLog.length > 5000) {
    store.practiceLog = store.practiceLog.slice(-5000);
  }
  saveStore();

  renderStats();
  renderHistory();

  // Auto-advance
  if (isCorrect) {
    setStatus("Correct!", "success");
    document.body.classList.add("celebrating");

    // Play Ding Sound
    playCorrectSound();

    // Confetti!
    if (typeof confetti === "function") {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#2d8f5a', '#ffe76a', '#ffffff']
      });
    }

    // Celebrate for 2 seconds
    setTimeout(() => {
      document.body.classList.remove("celebrating");
      nextWord();
    }, 2000);
  } else {
    setStatus("Saved. Next word...", "info");
    // Small delay so they see they clicked it, then next
    setTimeout(() => {
      nextWord();
    }, 400);
  }
}

function scheduleRemediation(wordId) {
  const filterKey = getCurrentFilterKey();
  const queue = getRemediationQueue(filterKey);
  const existing = queue.find((item) => item.wordId === wordId);

  if (existing) {
    // Reset their successful attempts back to 0 if they get it wrong again
    existing.consecutiveCorrect = 0;
  } else {
    // They need 2 consecutive correct attempts to graduate
    queue.push({ wordId, consecutiveCorrect: 0 });
  }
}

function handleCorrectReview(wordId) {
  const filterKey = getCurrentFilterKey();
  const queue = getRemediationQueue(filterKey);
  const index = queue.findIndex((item) => item.wordId === wordId);

  if (index !== -1) {
    const item = queue[index];
    item.consecutiveCorrect = (item.consecutiveCorrect || 0) + 1;

    // Graduate after 2 consecutive correct answers
    if (item.consecutiveCorrect >= 2) {
      queue.splice(index, 1);
    }
  }
}

function removeRemediationItem(filterKey, wordId) {
  const queue = getRemediationQueue(filterKey);
  const index = queue.findIndex((item) => item.wordId === wordId);
  if (index !== -1) {
    queue.splice(index, 1);
  }
}

function resetFilterProgress() {
  const filterKey = getCurrentFilterKey();
  store.askedHistoryByFilterKey[filterKey] = [];
  store.remediationQueueByFilterKey[filterKey] = [];
  saveStore();

  setIdleState();
  renderStats();
  setStatus("Progress for this filter was reset.");
}

function getCurrentFilterKey() {
  const year = ui.yearFilter.value || "All";
  const level = ui.levelFilter.value || "All";
  return `year=${year}|level=${level}`;
}

function getAskedIds(filterKey) {
  if (!Array.isArray(store.askedHistoryByFilterKey[filterKey])) {
    store.askedHistoryByFilterKey[filterKey] = [];
  }
  return store.askedHistoryByFilterKey[filterKey];
}

function getRemediationQueue(filterKey) {
  if (!Array.isArray(store.remediationQueueByFilterKey[filterKey])) {
    store.remediationQueueByFilterKey[filterKey] = [];
  }
  return store.remediationQueueByFilterKey[filterKey];
}

function createAttemptId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `a_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function getCurrentWord() {
  if (!runtime.currentWordId) {
    return null;
  }
  return runtime.wordById.get(runtime.currentWordId) || null;
}

function pickRandom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function setIdleState() {
  runtime.currentWordId = null;
  runtime.currentStep = STEPS.IDLE;
  runtime.currentPath = null;
  ui.wordMeta.textContent = "Word #";
  ui.revealSpelling.textContent = "";
  renderUiState();
}

function renderUiState() {
  const hasWord = Boolean(runtime.currentWordId);
  const step = runtime.currentStep;

  // ui.startBtn removed

  ui.playBtn.disabled = !hasWord;
  ui.slowBtn.disabled = !hasWord || step === STEPS.IDLE;
  ui.revealBtn.disabled = step !== STEPS.SPOKEN_WAIT_CHOICE;

  ui.forgotBtn.disabled = step !== STEPS.REVEALED_NEEDS_SCORE;
  ui.wrongBtn.disabled = step !== STEPS.REVEALED_NEEDS_SCORE;
  ui.hearBtn.disabled = step !== STEPS.REVEALED_NEEDS_SCORE;
  ui.correctBtn.disabled = step !== STEPS.REVEALED_NEEDS_SCORE;

  setActiveStage(step);

  const promptContainer = document.getElementById("wordPromptContainer");
  if (promptContainer) {
    if (step === STEPS.SPOKEN_WAIT_CHOICE) {
      promptContainer.style.display = "flex";
    } else {
      promptContainer.style.display = "none";
    }
  }

  // Toggle audio controls visibility within stageListen
  // The audio-box is inside stageListen. 
  // We want audio controls visible during SPOKEN_WAIT_CHOICE.
  // We want them HIDDEN during REVEALED_NEEDS_SCORE (to focus on word).
  // But wait, stageListen is HIDDEN during REVEALED_NEEDS_SCORE by setActiveStage.
  // So if stageListen is hidden, audio-box is hidden. 
  // The user says "How did you do" appears on initial screen.
  // Initial screen = IDLE. 
  // In IDLE, stageListen is hidden (step !== SPOKEN_WAIT_CHOICE).
  // stageScore is hidden (step !== REVEALED_NEEDS_SCORE).
  // So nothing should be visible except the header/nav.

  // If the user sees options, maybe step IS REVEALED_NEEDS_SCORE on load?
  // loading from localStorage?

  if (step === STEPS.IDLE) {
    ui.wordMeta.textContent = "Word #";
  } else {
    const word = getCurrentWord();
    if (word) {
      ui.wordMeta.textContent = `Word #${word.id}`;
    }
  }

  if (step === STEPS.REVEALED_NEEDS_SCORE) {
    const word = getCurrentWord();
    if (word) {
      if (word.variants.length > 1) {
        ui.revealSpelling.textContent = `${word.displaySpelling} (${word.variants.join(" / ")})`;
      } else {
        ui.revealSpelling.textContent = word.displaySpelling;
      }
    }
  } else {
    // Only clear if we are NOT in REVEALED state. 
    // If we are in SPOKEN state, we want to hide spelling.
    ui.revealSpelling.textContent = "";
  }
}

function playCorrectSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = "sine";
  osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
  osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1); // C6

  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.5);
}

function setActiveStage(step) {
  // ui.stageStart removed
  // stageListen should be active in SPOKEN_WAIT_CHOICE
  ui.stageListen.classList.toggle("is-active", step === STEPS.SPOKEN_WAIT_CHOICE);

  // stageScore should be active in REVEALED_NEEDS_SCORE
  ui.stageScore.classList.toggle("is-active", step === STEPS.REVEALED_NEEDS_SCORE);
}

function renderRevealText() {
  const word = getCurrentWord();
  if (!word) {
    ui.revealSpelling.textContent = "";
    return;
  }

  if (runtime.currentStep === STEPS.REVEALED_NEEDS_SCORE) {
    if (word.variants.length > 1) {
      ui.revealSpelling.textContent = `${word.displaySpelling} (${word.variants.join(" / ")})`;
    } else {
      ui.revealSpelling.textContent = word.displaySpelling;
    }
  } else {
    ui.revealSpelling.textContent = "";
  }
}

function renderStats() {
  const attempts = store.practiceLog.length;
  const correctAttempts = store.practiceLog.filter((record) => record.result === "correct").length;
  const incorrectAttempts = attempts - correctAttempts;
  const accuracy = attempts ? Math.round((correctAttempts / attempts) * 100) : 0;

  const filterKey = getCurrentFilterKey();
  const askedIds = getAskedIds(filterKey);
  const askedSet = new Set(askedIds);
  const remaining = runtime.filteredWordIds.filter((id) => !askedSet.has(id)).length;

  ui.attemptCount.textContent = String(attempts);
  ui.accuracyStat.textContent = `${accuracy}%`;
  ui.missedCount.textContent = String(incorrectAttempts);
  ui.remainingCount.textContent = String(remaining);
}

function renderHistory() {
  if (!ui.historyContent) return;
  ui.historyContent.innerHTML = "";

  const filterKey = getCurrentFilterKey();
  const queue = getRemediationQueue(filterKey);
  const askedIds = getAskedIds(filterKey);

  // Find words that need review
  const needsReviewIds = new Set(queue.map(item => item.wordId));
  const reviewWords = Array.from(needsReviewIds)
    .map(id => runtime.wordById.get(id))
    .filter(Boolean);

  // Find words that are mastered (asked, but not in review queue)
  const masteredIds = askedIds.filter(id => !needsReviewIds.has(id));
  const masteredWords = masteredIds
    .map(id => runtime.wordById.get(id))
    .filter(Boolean)
    // Reverse so most recently mastered are at top
    .reverse();

  if (reviewWords.length === 0 && masteredWords.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No attempts yet. Start practicing!";
    ui.historyContent.appendChild(empty);
    return;
  }

  // Render "Needs Review" group
  if (reviewWords.length > 0) {
    const section = createHistorySection("Needs Review", reviewWords.length, "needs-review", reviewWords);
    ui.historyContent.appendChild(section);
  }

  // Render "Mastered" group
  if (masteredWords.length > 0) {
    const section = createHistorySection("Mastered", masteredWords.length, "mastered", masteredWords);
    ui.historyContent.appendChild(section);
  }
}

function createHistorySection(title, count, statusClass, words) {
  const section = document.createElement("div");
  section.className = "history-section";

  const header = document.createElement("div");
  header.className = "history-section-title";

  const titleSpan = document.createElement("span");
  titleSpan.textContent = title;

  const countBadge = document.createElement("span");
  countBadge.textContent = count;
  countBadge.style.fontSize = "0.9rem";
  countBadge.style.color = "var(--muted)";
  countBadge.style.fontWeight = "normal";

  header.appendChild(titleSpan);
  header.appendChild(countBadge);
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "history-grid";

  for (const word of words) {
    const chip = document.createElement("div");
    chip.className = `word-chip ${statusClass}`;

    const audioBtn = document.createElement("button");
    audioBtn.className = "chip-audio-btn";
    audioBtn.innerHTML = "🔊";
    audioBtn.onclick = () => speakText(word.displaySpelling, 1);

    const textSpan = document.createElement("span");
    textSpan.className = "chip-word-text";
    textSpan.textContent = word.displaySpelling;

    chip.appendChild(audioBtn);
    chip.appendChild(textSpan);
    grid.appendChild(chip);
  }

  section.appendChild(grid);
  return section;
}

function speakCurrentWord(rate) {
  const word = getCurrentWord();
  if (!word) {
    return;
  }
  speakText(word.displaySpelling, rate);
}

async function speakText(text, rate) {
  setSpeakingState(true);
  try {
    if (runtime.ttsEngine === "piper") {
      await speakWithPiper(text);
    } else {
      await speakWithBrowser(text, rate);
    }
  } finally {
    setSpeakingState(false);
  }
}

function setSpeakingState(isSpeaking) {
  if (isSpeaking) {
    document.body.classList.add("is-speaking");
  } else {
    document.body.classList.remove("is-speaking");
  }
}

async function speakWithPiper(text) {
  try {
    let tts = runtime.piperInstance;

    if (!tts) {
      // Lazy load / Init logic matched to piper_test.html
      setStatus("Initializing High Quality Voice...", "info");

      let storedModule = piperModule.default || piperModule;
      if (storedModule && storedModule.default) {
        storedModule = storedModule.default;
      }

      // Check if it's already an instance or needs instantiation
      if (typeof storedModule.predict === 'function') {
        tts = storedModule;
      } else {
        try {
          tts = new storedModule();
        } catch (e) {
          console.warn("Could not instantiate piper module, trying raw object", e);
          tts = storedModule;
        }
      }

      if (typeof tts.predict !== 'function') {
        // Final attempt: maybe it's nested differently?
        throw new Error("Piper module does not export a predict function.");
      }

      runtime.piperInstance = tts;
    }

    const voiceId = ui.voiceSelect.value;

    // Show spinner or loading state if needed
    // setStatus("Generating...", "info"); 

    const audioBlob = await tts.predict({
      text: text,
      voiceId: voiceId,
    });

    return new Promise((resolve, reject) => {
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onended = () => resolve();
      audio.onerror = (e) => reject(e);
      audio.play().catch(reject);
    });

  } catch (err) {
    console.error("Piper Error:", err);
    setStatus(`High Quality Voice failed: ${err.message}. Switching to Browser Default.`, "error");
    // Fallback
    runtime.ttsEngine = "browser";
    ui.ttsEngineSelect.value = "browser";
    refreshVoiceList();
    speakWithBrowser(text, 1);
  }
}

function speakWithBrowser(text, rate) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      setStatus("This browser does not support speech audio.", "error");
      resolve();
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    // A small timeout allows the browser to clear its speech queue properly
    // This fixes a known bug in Safari and Edge where speak() immediately after cancel() is ignored
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;

      const selectedVoiceUri = ui.voiceSelect.value;
      if (selectedVoiceUri) {
        const matchingVoice = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === selectedVoiceUri);
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }
      }

      // Hack for Chromium/Edge: 
      // Keep a reference to the utterance globally so it doesn't get aggressively garbage collected
      // before the onend event fires.
      window._activeSpeechUtterance = utterance;

      let hasResolved = false;
      const cleanupAndResolve = () => {
        if (!hasResolved) {
          hasResolved = true;
          window._activeSpeechUtterance = null;
          resolve();
        }
      };

      utterance.onend = cleanupAndResolve;

      utterance.onerror = (e) => {
        // Some browsers fire onerror when cancel() is called. We should just resolve.
        console.warn("SpeechSynthesis error:", e);
        cleanupAndResolve();
      };

      // Fallback: Just in case onend never fires (Web Speech API can be buggy)
      // Resolve after 5 seconds to ensure animation doesn't get stuck forever
      setTimeout(cleanupAndResolve, 5000);

      window.speechSynthesis.speak(utterance);
    }, 50);
  });
}

// Piper Voices Data
const PIPER_VOICES = [
  { name: "Amy (Female)", id: "en_US-amy-medium" },
  { name: "Lessac (Female - Medium)", id: "en_US-lessac-medium" },
  { name: "Lessac (Female - High)", id: "en_US-lessac-high" },
  { name: "Danny (Male)", id: "en_US-danny-low" },
  { name: "Ryan (Male)", id: "en_US-ryan-medium" },
];

function initVoices() {
  // Check if browser supports speech for fallback
  if (!("speechSynthesis" in window)) {
    // Force Piper or disable browser option?
    // For now, let's just let it be.
  }

  // Sync UI with initial state
  if (ui.ttsEngineSelect) {
    ui.ttsEngineSelect.value = runtime.ttsEngine;
  }

  refreshVoiceList();

  // Chrome loads voices asynchronously, so we need this to update the list if valid
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      if (runtime.ttsEngine === "browser") {
        refreshVoiceList();
      }
    };
  }
}

function refreshVoiceList() {
  ui.voiceSelect.innerHTML = "";
  const engine = runtime.ttsEngine;

  if (engine === "piper") {
    PIPER_VOICES.forEach(voice => {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.name;
      ui.voiceSelect.appendChild(option);
    });
    // Default to Amy
    if (ui.voiceSelect.options.length > 0) {
      ui.voiceSelect.value = PIPER_VOICES[0].id;
    }
  } else {
    // Browser voices
    let voices = window.speechSynthesis.getVoices();

    // Filter for US English only (handle en-US and en_US)
    voices = voices.filter(v => v.lang.replace('_', '-').startsWith('en-US'));

    // Define "High Quality" terms.
    const highQualityTerms = ["natural", "google", "samantha", "alex", "ava", "allison", "siri", "enhanced"];

    // Filter for High Quality voices
    const naturalVoices = voices.filter(v => {
      const name = v.name.toLowerCase();
      if (name.includes("fred")) return false;
      return highQualityTerms.some(term => name.includes(term));
    });

    let displayVoices = naturalVoices.length > 0 ? naturalVoices : voices;

    displayVoices.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      const aTier1 = nameA.includes("jenny") || nameA.includes("guy");
      const bTier1 = nameB.includes("jenny") || nameB.includes("guy");
      if (aTier1 && !bTier1) return -1;
      if (!aTier1 && bTier1) return 1;

      const aTier2 = nameA.includes("samantha") || nameA.includes("alex");
      const bTier2 = nameB.includes("samantha") || nameB.includes("alex");
      if (aTier2 && !bTier2) return -1;
      if (!aTier2 && bTier2) return 1;

      return nameA.localeCompare(nameB);
    });

    if (displayVoices.length === 0) {
      const option = document.createElement("option");
      option.textContent = "No US voices found";
      ui.voiceSelect.appendChild(option);
      return;
    }

    for (const voice of displayVoices) {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = voice.name;
      ui.voiceSelect.appendChild(option);
    }

    if (displayVoices.length > 0) {
      ui.voiceSelect.value = displayVoices[0].voiceURI;
    }
  }
}

function testSelectedVoice() {
  const text = "Hello! This is how I sound.";
  speakText(text, 1);
}

function setStatus(message, tone = "info") {
  ui.statusMessage.textContent = message;
  if (tone === "error") {
    ui.statusMessage.style.color = "#a23e21";
  } else if (tone === "success") {
    ui.statusMessage.style.color = "#1f6942";
  } else {
    ui.statusMessage.style.color = "#111111";
  }
}

function defaultStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    practiceLog: [],
    askedHistoryByFilterKey: {},
    remediationQueueByFilterKey: {},
  };
}

function loadStore() {
  const fallback = defaultStore();
  let raw = null;

  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    storageReadOnly = true;
    console.warn("localStorage is not available. Running without persistence.", error);
    return fallback;
  }

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    const version = Number(parsed.schemaVersion || 0);
    if (version > SCHEMA_VERSION) {
      storageReadOnly = true;
      return {
        ...fallback,
        practiceLog: Array.isArray(parsed.practiceLog) ? parsed.practiceLog : [],
      };
    }

    const migrated = migrateToCurrentSchema(parsed, version);
    migrated.practiceLog = Array.isArray(migrated.practiceLog) ? migrated.practiceLog : [];
    migrated.askedHistoryByFilterKey = isObject(migrated.askedHistoryByFilterKey)
      ? migrated.askedHistoryByFilterKey
      : {};
    migrated.remediationQueueByFilterKey = isObject(migrated.remediationQueueByFilterKey)
      ? migrated.remediationQueueByFilterKey
      : {};
    return migrated;
  } catch (error) {
    console.warn("Failed to parse stored app state. Resetting state.", error);
    return fallback;
  }
}

function migrateToCurrentSchema(parsed, version) {
  let next = { ...parsed };
  let currentVersion = version;

  if (currentVersion < 1) {
    next = {
      schemaVersion: 1,
      practiceLog: Array.isArray(parsed.practiceLog) ? parsed.practiceLog : [],
      askedHistoryByFilterKey: isObject(parsed.askedHistoryByFilterKey) ? parsed.askedHistoryByFilterKey : {},
      remediationQueueByFilterKey: isObject(parsed.remediationQueueByFilterKey)
        ? parsed.remediationQueueByFilterKey
        : {},
    };
    currentVersion = 1;
  }

  next.schemaVersion = currentVersion;
  return next;
}

function saveStore() {
  if (storageReadOnly) {
    return;
  }

  try {
    const payload = {
      ...store,
      schemaVersion: SCHEMA_VERSION,
      lastUpdatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    storageReadOnly = true;
    console.warn("Failed to save app state. Continuing in read-only storage mode.", error);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
