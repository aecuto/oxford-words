# AGENTS.md

## Commands
- Package manager: **pnpm**.
- Verify changes with, in order: `pnpm lint` → `npx tsc --noEmit` (not an npm script) → `pnpm smoke`.
- There is no test framework. `pnpm smoke` runs `scripts/smoke-wordPool.ts` (tsx, no services needed): it simulates PvP and PvE battles against the real word data and fails on duplicate words, missing/short option grids, or back-to-back repeats. Run it after touching word picking, the pool, or SRS logic.

## Word data pipeline
- `public/words.3000.th.json` and `public/words.5000.th.json` are **generated** (minified single lines) and fetched at runtime by `loadWordPool(list)` in `src/game/wordPool.ts` — never import them into the bundle; the battle page fetches once per session. The files (and lists) are exclusive: 3000 plays only the `ox3000` words, 5000 only the extra `ox5000` words — no merging (the default is the player's persisted pick in `src/game/wordList.ts`, selected from the lobby toggle).
- Regeneration has two interchangeable translators in sibling folders under `tools/translator/`, both emitting the same answerable-only, pre-deduped flat output files: `pnpm translate-etlex` (= `tsx tools/translator/translator-etlex/index.ts`; CSV merge with the Thai lexicon → both files + `translator-etlex/missing.txt`), or the two-phase AI pipeline: `pnpm translate-ai` (= `tsx tools/translator/translator-gemini/cache.ts`; Gemini via `@google/genai`, needs `GEMINI_API_KEY` in the process env — tsx does not load `.env.local`: batches of 20 words with POS-specific prompts — verb vs noun must translate differently — journals every finished batch to `translator-gemini/ai-cache.json` and resumes from it on re-run (delete entries there to force a re-translate), `--limit=N` caps pairs, paced to the model's RPM quota via `GEMINI_RPM`; writes only the cache), then `pnpm translate-ai-map` (= `tsx tools/translator/translator-gemini/map.ts`; offline, no API key — maps `ai-cache.json` onto the scrapper rows → both files). Translator output lands in the translator's folder — copy it to `public/` after reviewing.
- Shared word-data rules live in `src/game/wordData.ts`: the POS → entry-type codes (`posCode`, e.g. adjective → `ADJ`), the headword dedupe (`dedupeByHeadword`), and the scrapper-row types + normalization (`WordRow` — typed from the scrapper's `words.json` output — /`normalizeWord`/`resolveThai`; runtime `Word` is `WordRow` plus the flat POS-resolved `thai` answer string — `resolveThai(type, thaiByType)` picks the row's POS translations at build time, so no per-POS structure ever reaches the files — re-exported as `Word` via `types.ts`). Both translators, the scrapper, `wordPool.ts`, and `types.ts` import them — never copy the mapping, the dedupe loop, or the row shapes into another file.
- The raw data lists a headword once per part of speech, so it is full of duplicates. The translators dedupe upstream, but `dedupeWords()` must stay applied in `loadWordPool`/`pickBattleWords` anyway or the same word gets dealt twice in one battle — `pnpm smoke` catches this.

## Word picking (PvP and PvE share one pipeline)
- Both modes must go through `pickBattleWords` in `src/game/wordPool.ts`; PvP adds only `roomWordSet` (same file — both full halves merged to `MAX_WORDS_PER_ROOM`) and the `exclude` argument. Do not fork per-mode picking logic.
- `exclude` is required for PvP: each player's SRS stats are local-only, so a word the opponent just played stays "fresh" for me unless explicitly excluded (see `useRoomBattleStore.join`, `result/page.tsx` rematch, the solo store's mount). Excluded words only return to top up a pool that runs dry.
- SRS lives in `src/game/wordProgress.ts` (localStorage `solo:wordStats:v1`): wrong answer → `ivl 0` (due immediately), but a 30-min cooldown keeps just-seen words out of reviews; reviews outweigh new words at a fixed 1:2 cycle.

## The game: Infinite Tic-Tac-Toe
- A correct answer earns one mark placement on a shared 3x3 board (`src/game/tictactoe.ts` — pure rules both modes import: `applyPlacement`, `checkWinner`, `botPickCell`). Each side holds at most `MARKS_PER_PLAYER` (3) marks — a 4th placement fades their oldest still-on-board mark — so the board never draws; 3 in a row wins. A miss (wrong/timeout) just earns nothing.
- Placement is the player's tap (PvP writes via the `placeMark` transaction — collisions are no-ops and the player re-taps); the solo bot picks via `botPickCell`. If the words run out before a win, solo tops up from the pool and PvP draws its merged `words[20..]`; only a truly dry deal judges by correct answers (`correctIdx`/`wrongIdx` accumulate on the room doc per answer).


## Architecture
- Next.js App Router (Next 16, React 19, Tailwind 3 + Material Tailwind UI in `src/app/components/ui`). Routes: `/` lobby (create/join room), `/solo` PvE vs bot, `/battle/room` PvP, `/result`.
- `src/game/` is framework-free logic; battle state lives in the zustand stores in `src/app/stores/` (`useSoloBattleStore`, `useRoomBattleStore`). Tuning constants (WORDS_PER_BATTLE, MARKS_PER_PLAYER, timers, Firestore collection names) are in `src/lib/gameConfig.ts`. The solo bot — its stat block (`SOLO_BOT`), per-word decisions (accuracy, think time), and its answer clock (`createBotRunner`) — lives entirely in `src/game/botBrain.ts`; board placement is `botPickCell` in `tictactoe.ts`.
- Firebase: anonymous auth gates everything networked. Rooms are realtime Firestore docs (`oxfordwords_rooms/{code}` — the rules let any signed-in user write them), per-user progress is `oxfordwords_progress/{uid}`. If you rename collections, update `firestore.rules` too.
- `NEXT_PUBLIC_FIREBASE_*` in `.env.local` (see `.env.example`); the config is intentionally client-exposed — security is enforced by `firestore.rules`, not key secrecy.

## Gotchas
- README is stale: the stack is Firebase Firestore + localStorage/sessionStorage, not Dexie/IndexedDB.
- No CI and no pre-commit hooks; deploys are Vercel auto-detect from the repo.
- `src/game/` files carry short comments explaining non-obvious decisions (picking rules, cooldowns) — follow that convention when changing them.
