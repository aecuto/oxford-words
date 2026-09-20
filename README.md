Deployed on Vercel. Import the repo at [vercel.com/new](https://vercel.com/new) — Next.js is auto-detected, no extra config needed.

## Dev
```bash
pnpm dev
```

## Fetch Words
1. Go to [Oxford 3000-5000](https://www.oxfordlearnersdictionaries.com/wordlists/oxford3000-5000)
2. Copy the `<ul>` tag into `scrapper/data.txt`
3. Run `pnpm fetch-oxford-words`

Output saved to `scrapper/words.json`

## Stack
- Material Tailwind
- Dexie (IndexedDB)
