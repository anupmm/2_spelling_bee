# Spelling Bee Practice App - Implementation Plan (MVP)

## 0. Product Decisions (Locked for v1)

These decisions are included in v1 (not deferred), because they are high-impact and low complexity:

- `Don't know spelling` always records `incorrect` (no confirmation step in v1).
- Explicit UI state machine governs button visibility and allowed actions.
- Minimal remediation loop: missed words are re-asked after 5 other asked words in same filter context.
- Local persistence is versioned (`schemaVersion`) to support safe future migrations.
- Parent-facing micro-metrics are shown: `attempts`, `correct %`, `missed words count`.

Deferred to v2:
- Separate strict `Check Mode` vs `Practice Mode`.
- Spaced repetition/mastery scheduling.
- Advanced analytics/export and multi-profile support.

## 1. Goals and Constraints

### Primary goal
Build a child-friendly web app for 2nd-grade spelling practice using `curated_word_list.csv`.

### Scope constraints (MVP)
- Client-side web app only (no backend required).
- Single-user usage on one device/browser.
- Store progress/history locally for later browsing.
- Random non-repeating word selection inside the current filtered pool.

### Dataset assumptions from current CSV
- Columns: `Year`, `Level`, `Words`
- Example levels: `One Bee`, `Two Bee`, `Three Bee`
- Variant spellings may exist in `Words` separated by `;` (e.g., `moustache; mustache`)

## 2. MVP User Experience

### Main practice flow
1. User selects filters (initially `Year` and `Level`, extensible later).
2. User clicks `Start` or `Next Word`.
3. App picks one random unasked item from filtered pool.
4. App speaks the word automatically and shows only metadata (e.g., `Word #123`).
5. User can click:
   - `Hear Again`
   - `Don't know spelling`
   - `Know spelling (want to check)`
6. Reveal behavior:
   - `Don't know spelling`: reveal immediately and score as incorrect (automatic in v1).
   - `Know spelling`: reveal on `Reveal Spelling`, then user self-scores `Correct` / `Incorrect`.
7. App logs the attempt and moves to `Next Word`.

### History flow
- Separate history view/table with filters:
  - `All`
  - `Correct`
  - `Incorrect`
  - (Optional) by `Year` and `Level`
- Display timestamp, word ID, spoken form, revealed spelling, result.

## 3. Information Architecture

### Screens/sections
- `Practice` tab
- `History` tab
- Optional compact `Stats` strip at top (asked count, remaining count, correct rate)

### Core UI components
- Filter bar
- Current word card
- Action buttons (`Hear Again`, `Don't know`, `Know spelling`, `Reveal`, `Correct`, `Incorrect`, `Next`)
- Progress indicator (`Remaining in pool: N`)
- History table/list with filter chips

## 4. Data Model

## 4.1 Canonical word item (parsed from CSV)
Each CSV row becomes one item:

- `id`: stable numeric ID (row index + 1)
- `year`: string
- `level`: string
- `rawWords`: original `Words` string from CSV
- `variants`: array created by splitting on `;`, trimming whitespace, preserving order
- `displaySpelling`: first variant (for reveal)

Example:
- `rawWords = "moustache; mustache"`
- `variants = ["moustache", "mustache"]`
- `displaySpelling = "moustache"`

## 4.2 Practice state (in memory)
- `activeFilters`
- `filteredWordIds`
- `askedWordIdsForFilterSession` (set)
- `currentWordId`
- `currentStep` (heard / deciding / revealed / scored)

## 4.3 Persistent local storage
Use browser storage to persist:

- `schemaVersion` (number, starts at `1`)
- `appStateVersioned`
  - `version`
  - `lastUpdatedAt`
- `practiceLog[]`
  - `attemptId`
  - `timestamp`
  - `wordId`
  - `year`
  - `level`
  - `displaySpelling`
  - `allVariants`
  - `result` (`correct` | `incorrect`)
  - `path` (`dont_know` | `know_then_reveal`)
- `askedHistoryByFilterKey`
  - Keyed by normalized filter key (e.g., `year=2025-2026|level=Two Bee`)
  - Value: set/list of asked `wordId`s
- `remediationQueueByFilterKey`
  - Value: list of `{ wordId, dueAfterAskedCount }`

### 4.4 Migration rules
- On startup, if storage version is missing or older:
  - initialize defaults for missing keys
  - run targeted migration function
  - write back with current `schemaVersion`
- If version is newer than app supports:
  - show non-blocking warning and fallback to read-only history mode

## 4.5 State machine (explicit)

States:
- `idle` (no current word)
- `spoken_wait_choice` (word played, waiting on `Don't know` or `Know spelling`)
- `await_reveal` (`Know spelling` chosen)
- `revealed_needs_score` (answer visible, waiting score buttons)
- `scored_ready_next` (attempt logged, waiting `Next Word`)

Allowed transitions:
- `idle -> spoken_wait_choice` on `Start`/`Next Word` + successful selection
- `spoken_wait_choice -> revealed_needs_score` on `Don't know spelling` (auto incorrect path)
- `spoken_wait_choice -> await_reveal` on `Know spelling`
- `await_reveal -> revealed_needs_score` on `Reveal Spelling`
- `revealed_needs_score -> scored_ready_next` on `Correct`/`Incorrect` (or auto incorrect from `Don't know`)
- `scored_ready_next -> spoken_wait_choice` on `Next Word`

Guardrails:
- `Reveal` hidden outside `await_reveal`
- Score buttons hidden outside `revealed_needs_score`
- `Next Word` disabled before an attempt is logged
- `Hear Again` available in all non-idle states

## 5. Word Selection and No-Repeat Logic

### Pool construction
- Rebuild pool whenever filters change.
- Pool = all word IDs matching active filters.

### Non-repeat selection
- Exclude IDs already present in `askedHistoryByFilterKey[currentFilterKey]`.
- From remaining IDs, choose one uniformly at random.

### Missed-word remediation in v1
- If an attempt is scored `incorrect`, add that `wordId` to remediation queue with:
  - `dueAfterAskedCount = currentAskedCount + 5`
- On each `Next Word`, choose candidate in this order:
  1. Due remediation words not asked in current turn.
  2. New unseen words from filtered pool.
  3. If unseen exhausted, remaining remediation words.
- Prevent immediate back-to-back repetition of same `wordId`.

### Exhaustion handling
When remaining pool is empty:
- Show `All words for this filter are completed`.
- Offer:
  - `Reset this filter set` (clear asked IDs for current filter key only)
  - `Change filters`

### Why key by filter
This preserves progress per filter combination and avoids confusing repeats when users switch levels/years.

## 6. TTS Strategy (Lightweight + Free)

### Default for MVP
- Use browser Web Speech API (`speechSynthesis`) on client side.
- Benefits: zero backend, no extra install, quick iteration.

### TTS behavior rules
- Auto-speak on new word.
- Provide `Hear Again` button.
- Provide `Slower` playback option in v1 (via speech rate reduction).
- Provide voice fallback picker in v1 if multiple voices are available.
- Add simple retries/fallback if speech fails.

### Future fallback option
- If pronunciation quality is unacceptable, add optional local/offline engine (e.g., Piper service) behind same `speak(text)` interface.

## 7. Extensible Filtering Design

### Current dimensions
- `Year`
- `Level`

### Future-proof approach
- Build filter config from known columns + optional metadata map.
- Normalize records into dictionary shape so adding columns later only requires:
  - exposing UI control
  - adding predicate in filter engine

### Recommendation
Keep filters declarative (config array) instead of hardcoding per field.

## 8. Storage Choice

### MVP recommendation
- Start with `localStorage` (simple key-value, enough for this dataset and log volume).

### Upgrade trigger
- Move to `IndexedDB` only if logs become large or query flexibility/performance becomes limiting.

## 9. Error Handling and Edge Cases

- CSV parse failure -> show friendly error and disable practice.
- Empty filtered pool -> prompt to adjust filters.
- TTS unavailable -> show `Audio unavailable` notice, still allow reveal and scoring.
- Variant formatting noise (`extra spaces`, empty tokens) -> trim and discard empties.
- Duplicate rows (if any) -> keep separate IDs unless dedupe is explicitly desired.

## 10. Accessibility and Child-Friendly UX

- Large tap targets and high-contrast buttons.
- Minimal text density on practice card.
- Consistent button placement to reduce cognitive load.
- Keyboard accessibility for desktop use.
- Optional subtle success/fail color cues in history.

## 11. Suggested Technical Stack (Simple)

- Frontend: plain HTML/CSS/JS.
- Data ingest: parse CSV at load time.
- Persistence: browser `localStorage`.
- TTS: Web Speech API.

Keep architecture modular even in MVP:
- `data/parse`
- `state/selection`
- `services/tts`
- `services/storage`
- `ui/practice`
- `ui/history`

## 12. Milestone Plan

### Milestone 1: Data + Practice Loop
- Load and parse CSV.
- Implement filters (`Year`, `Level`).
- Implement explicit state machine and button gating.
- Implement random non-repeating picker per filter key.
- Add `Hear`, `Hear Again`, `Don't know`, `Know spelling`, `Reveal`, and scoring actions.
- Implement minimal remediation queue for incorrect words.

### Milestone 2: History Persistence
- Persist versioned app state (`schemaVersion`, logs, asked history, remediation queue).
- Implement history page with result filter (`All/Correct/Incorrect`).
- Add clear/reset controls.

### Milestone 3: Completion + Robustness
- Add exhaustion handling and reset-by-filter.
- Add TTS failure fallback messaging.
- Add basic stats (attempted, remaining, accuracy, missed count).
- Add startup migration checks for storage schema.

### Milestone 4: Polish
- Improve child-friendly UI styling.
- Add optional small settings (speech rate/voice if supported).
- Improve empty/error states.

## 13. Acceptance Criteria for MVP

- User can filter by `Year` and `Level`.
- User can hear a random word and replay audio.
- User can choose `Don't know spelling` or `Know spelling (want to check)`.
- User can reveal spelling and self-score.
- App does not repeat words within current filter history until exhaustion.
- Incorrect words reappear after a short delay (5 other asked words) in same filter context.
- Practice history is saved locally and browsable with correct/incorrect filters.
- User can reset completion for current filter set.
- App state survives refresh without data corruption across versioned schema.

## 14. Post-MVP Enhancements (Optional)

- Add typed answer mode (auto-check against variants).
- Add spaced repetition for incorrect words.
- Add export/import of history JSON.
- Multi-profile support for siblings.
- Add pronunciation source fallback (optional local TTS service).

## 15. Immediate Next Step (Execution)

Implement Milestone 1 now using plain HTML/CSS/JS:

1. Create app shell (`index.html`, `styles.css`, `app.js`).
2. Add CSV loader + parser and canonical word model.
3. Add filter controls (`Year`, `Level`) with dynamic options from CSV.
4. Implement practice state machine with gated buttons.
5. Add TTS service wrapper (`speak`, `repeat`, `slower`).
6. Add selection engine (non-repeat + remediation queue).
7. Add local persistence adapter with `schemaVersion = 1` for core state.
