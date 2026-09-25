# AGENTS.md

## Commands
- Package manager: **pnpm**.
- Verify changes with, in order: `pnpm lint` → `npx tsc --noEmit` (not an npm script) → `pnpm smoke`.
- There is no test framework. `pnpm smoke` runs `scripts/smoke-wordPool.ts` (tsx, no services needed): it simulates PvP and PvE battles against the real word data and fails on duplicate words, missing/short option grids, or back-to-back repeats. Run it after touching word picking, the pool, or SRS logic.

## Word data pipeline
- `public/words.th.json` is **generated** (~2.3MB, minified single line) and fetched at runtime by `loadWordPool()` in `src/game/wordPool.ts` — never import it into the bundle; the battle page fetches it once per session.
- Regeneration is two steps: `pnpm fetch-oxford-words` (scrapper: paste the Oxford 3000–5000 `<ul>` HTML into `tools/scrapper/data.txt` → `tools/scrapper/words.json`), then `tsx tools/translator/index.ts` (merges with the Thai lexicon CSV → `public/words.th.json` + `tools/translator/missing.txt`).
- The raw data lists a headword once per part of speech, so it is full of duplicates. `dedupeWords()` must stay applied in `loadWordPool`/`pickBattleWords` or the same word gets dealt twice in one battle — `pnpm smoke` catches this.

## Word picking (PvP and PvE share one pipeline)
- Both modes must go through `pickBattleWords` in `src/game/wordPool.ts`; PvP adds only `mergeWordLists` (host+guest interleave) and the `exclude` argument. Do not fork per-mode picking logic.
- `exclude` is required for PvP: each player's SRS stats are local-only, so a word the opponent just played stays "fresh" for me unless explicitly excluded (see `useBattleRoom.join`, `result/page.tsx` rematch, `useSoloBattle.reset`). Excluded words only return to top up a pool that runs dry.
- SRS lives in `src/game/wordProgress.ts` (localStorage `solo:wordStats:v1`): wrong answer → `ivl 0` (due immediately), but a 30-min cooldown keeps just-seen words out of reviews; review words are capped at 70% of a battle.

## Architecture
- Next.js App Router (Next 16, React 19, Tailwind 3 + Material Tailwind UI in `src/app/components/ui`). Routes: `/` lobby (create/join room), `/solo` PvE vs bot, `/battle/room` PvP, `/result`.
- `src/game/` is framework-free logic; React battle state lives in `src/app/` hooks (`useSoloBattle`, `useBattleRoom`). Tuning constants (WORDS_PER_BATTLE, damage, bot configs, Firestore collection names) are in `src/lib/gameConfig.ts`.
- Firebase: anonymous auth gates everything networked. Rooms are realtime Firestore docs (`oxfordwords_rooms/{code}` — the rules let any signed-in user write them), per-user progress is `oxfordwords_progress/{uid}`. If you rename collections, update `firestore.rules` too.
- `NEXT_PUBLIC_FIREBASE_*` in `.env.local` (see `.env.example`); the config is intentionally client-exposed — security is enforced by `firestore.rules`, not key secrecy.

## Gotchas
- README is stale: the stack is Firebase Firestore + localStorage/sessionStorage, not Dexie/IndexedDB.
- No CI and no pre-commit hooks; deploys are Vercel auto-detect from the repo.
- `src/game/` files carry short comments explaining non-obvious decisions (picking rules, cooldowns) — follow that convention when changing them.
