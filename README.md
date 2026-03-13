## Visit: [https://aecuto.github.io/oxford-words](https://aecuto.github.io/oxford-words)

## Development

First, run the development server:

```bash
npm run dev
```

## Scrapping Oxford Words

The scrapper extracts word data from Oxford Learners Dictionaries and generates a `words.json` file.

### Usage:

goto https://www.oxfordlearnersdictionaries.com/wordlists/oxford3000-5000
filter list oxford 5000
copy ul tag into `scrapper/data.txt`

```bash
npm run fetch-oxford-words
```

The output will be saved to `scrapper/words.json`

### Output Format:

Each word entry contains:

- `word`: The word string
- `type`: Part of speech (noun, verb, etc.)
- `level`: CEFR level (a1, a2, b1, b2, c1)
- `ox3000`: Included in Oxford 3000
- `ox5000`: Included in Oxford 5000
- `pronounce`: URL to US pronunciation audio

## Tech Stack

- material tailwind
- indexDB dexie
- scrapper data
