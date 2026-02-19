# Spelling Bee Practice App

Minimal client-side web app for 2nd-grade spelling practice using `curated_word_list.csv`.

## Run locally

Open a terminal in this folder and run one of these:

```powershell
python -m http.server 8000
```

Then open:

`http://localhost:8000`

## Current implementation status

- Milestone 1 started and scaffolded.
- CSV parsing (`Year`, `Level`, `Words`) with `;` spelling variants.
- Filter by year and level.
- Practice state machine with gated buttons.
- Piper TTS (High Quality) with fallback to browser speech API (`Hear Again`, `Hear Slower`).
- Non-repeat selection by filter plus minimal incorrect-word remediation queue.
- Local storage schema versioning (`schemaVersion = 1`).
- Recent attempts list and basic stats.
