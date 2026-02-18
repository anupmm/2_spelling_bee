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
  ui.historyList = document.getElementById("historyList");
}

function bindEvents() {
  ui.tabButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  ui.applyFiltersBtn.addEventListener("click", applyFilters);
  ui.resetFilterProgressBtn.addEventListener("click", resetFilterProgress);
  ui.testVoiceBtn.addEventListener("click", testSelectedVoice);

  // Play button repeats if already conducting word
  ui.playBtn.addEventListener("click", () => speakCurrentWord(1));
  ui.slowBtn.addEventListener("click", () => speakCurrentWord(0.5));

  // ui.startBtn removed

  ui.revealBtn.addEventListener("click", onReveal);

  ui.forgotBtn.addEventListener("click", () => scoreCurrentWord("incorrect"));
  ui.wrongBtn.addEventListener("click", () => scoreCurrentWord("incorrect"));
  ui.hearBtn.addEventListener("click", () => scoreCurrentWord("incorrect"));
  ui.correctBtn.addEventListener("click", () => scoreCurrentWord("correct"));

  ui.historyFilter.addEventListener("change", renderHistory);
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
  const askedCount = askedIds.length;

  const dueRemediation = remediationQueue.filter(
    (item) => item.dueAfterAskedCount <= askedCount && item.wordId !== runtime.lastWordId
  );

  if (dueRemediation.length) {
    const chosen = pickRandom(dueRemediation);
    removeRemediationItem(filterKey, chosen.wordId, chosen.dueAfterAskedCount);
    saveStore();
    return { id: chosen.wordId };
  }

  const unseen = runtime.filteredWordIds.filter((id) => !askedSet.has(id) && id !== runtime.lastWordId);
  if (unseen.length) {
    const chosenId = pickRandom(unseen);
    askedSet.add(chosenId);
    store.askedHistoryByFilterKey[filterKey] = Array.from(askedSet);
    saveStore();
    return { id: chosenId };
  }

  const anyRemediation = remediationQueue.filter((item) => item.wordId !== runtime.lastWordId);
  if (anyRemediation.length) {
    const chosen = pickRandom(anyRemediation);
    removeRemediationItem(filterKey, chosen.wordId, chosen.dueAfterAskedCount);
    saveStore();
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
  }

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
  // We can show a brief "Got it!" message if we want, but user asked for speed.
  // Let's just go straight to next word.
  setStatus(isCorrect ? "Correct! Next word..." : "Saved. Next word...", isCorrect ? "success" : "info");

  // Small delay so they see they clicked it, then next
  setTimeout(() => {
    nextWord();
  }, 400);
}

function scheduleRemediation(wordId) {
  const filterKey = getCurrentFilterKey();
  const askedCount = getAskedIds(filterKey).length;
  const dueAfterAskedCount = askedCount + 5;
  const queue = getRemediationQueue(filterKey);
  const existing = queue.find((item) => item.wordId === wordId);

  if (existing) {
    existing.dueAfterAskedCount = Math.min(existing.dueAfterAskedCount, dueAfterAskedCount);
  } else {
    queue.push({ wordId, dueAfterAskedCount });
  }
}

function removeRemediationItem(filterKey, wordId, dueAfterAskedCount) {
  const queue = getRemediationQueue(filterKey);
  const index = queue.findIndex((item) => item.wordId === wordId && item.dueAfterAskedCount === dueAfterAskedCount);
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
  const filterValue = ui.historyFilter.value;
  let entries = store.practiceLog.slice();

  if (filterValue === "correct") {
    entries = entries.filter((entry) => entry.result === "correct");
  } else if (filterValue === "incorrect") {
    entries = entries.filter((entry) => entry.result === "incorrect");
  }

  entries = entries.slice(-20).reverse();
  ui.historyList.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("li");
    empty.textContent = "No attempts yet.";
    ui.historyList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    const resultClass = entry.result === "correct" ? "result-correct" : "result-incorrect";
    const dateLabel = formatTimestamp(entry.timestamp);
    const details = document.createTextNode(`${dateLabel} - #${entry.wordId} ${entry.displaySpelling} - `);
    const resultSpan = document.createElement("span");
    resultSpan.className = resultClass;
    resultSpan.textContent = entry.result;
    item.appendChild(details);
    item.appendChild(resultSpan);
    ui.historyList.appendChild(item);
  }
}

function formatTimestamp(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleString();
}

function speakCurrentWord(rate) {
  const word = getCurrentWord();
  if (!word) {
    return;
  }
  speakText(word.displaySpelling, rate);
}

function speakText(text, rate) {
  if (!("speechSynthesis" in window)) {
    setStatus("This browser does not support speech audio.", "error");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;

  const selectedVoiceUri = ui.voiceSelect.value;
  if (selectedVoiceUri) {
    const matchingVoice = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === selectedVoiceUri);
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }
  }

  utterance.onerror = () => {
    setStatus("Audio failed. You can still use the revealed spelling.", "error");
  };

  window.speechSynthesis.speak(utterance);
}

function initVoices() {
  if (!("speechSynthesis" in window)) {
    ui.voiceSelect.disabled = true;
    fillSelect(ui.voiceSelect, ["Default"]);
    return;
  }

  const refreshVoices = () => {
    let voices = window.speechSynthesis.getVoices();
    const previousValue = ui.voiceSelect.value;

    // Filter for US English only (handle en-US and en_US)
    voices = voices.filter(v => v.lang.replace('_', '-').startsWith('en-US'));

    // Define "High Quality" terms.
    // Windows/Chrome: "natural", "google"
    // iOS/Mac: "samantha", "alex", "ava", "allison", "siri", "enhanced"
    const highQualityTerms = ["natural", "google", "samantha", "alex", "ava", "allison", "siri", "enhanced"];

    // Filter for High Quality voices
    const naturalVoices = voices.filter(v => {
      const name = v.name.toLowerCase();
      // Exclude "Fred" specifically as it's often robotic on Mac
      if (name.includes("fred")) return false;
      return highQualityTerms.some(term => name.includes(term));
    });

    // If we have natural voices, use ONLY those. 
    // If not, use all US voices (fallback for systems with no obvious "premium" keywords)
    // The user asked to "not show non natural", but if that results in 0 voices, the app breaks.
    // So we fallback, but we'll try to stick to the good ones.
    let displayVoices = naturalVoices.length > 0 ? naturalVoices : voices;

    // Sort: Jenny/Guy (Windows), then Samantha/Alex (Apple), then alphabetical
    displayVoices.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      // Tier 1: Microsoft Natural (Jenny, Guy)
      const aTier1 = nameA.includes("jenny") || nameA.includes("guy");
      const bTier1 = nameB.includes("jenny") || nameB.includes("guy");
      if (aTier1 && !bTier1) return -1;
      if (!aTier1 && bTier1) return 1;

      // Tier 2: Apple High Quality (Samantha, Alex)
      const aTier2 = nameA.includes("samantha") || nameA.includes("alex");
      const bTier2 = nameB.includes("samantha") || nameB.includes("alex");
      if (aTier2 && !bTier2) return -1;
      if (!aTier2 && bTier2) return 1;

      return nameA.localeCompare(nameB);
    });

    ui.voiceSelect.innerHTML = "";

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

    // Try to restore selection, or pick 0 (Top ranked)
    if (previousValue && displayVoices.some((v) => v.voiceURI === previousValue)) {
      ui.voiceSelect.value = previousValue;
    } else if (displayVoices.length > 0) {
      ui.voiceSelect.value = displayVoices[0].voiceURI;
    }
  };

  refreshVoices();

  // Chrome loads voices asynchronously, so we need this
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
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
