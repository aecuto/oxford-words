import HTMLParser from "node-html-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface WordData {
  word: string;
  type: string;
  level: string;
  ox3000: boolean;
  ox5000: boolean;
  pronounce: string;
}

fs.readFile(path.join(__dirname, "data.txt"), async (err, data) => {
  if (err) throw err;

  const root = HTMLParser.parse(data.toString());

  const result: WordData[] = [];

  for (const item of root.querySelectorAll("li")) {
    const ox5000 = !!item.getAttribute("data-ox5000");
    const ox3000 = !!item.getAttribute("data-ox3000");

    if (ox5000 || ox3000) {
      const word = item.querySelector("a")?.text || "-";
      const type = item.querySelector("span")?.text || "-";
      const level = item.querySelector("div span")?.text || "-";
      const pronouncePath =
        item.querySelector("div .pron-us")?.getAttribute("data-src-mp3") || "-";

      const pronounce =
        pronouncePath !== "-"
          ? "https://www.oxfordlearnersdictionaries.com" + pronouncePath
          : "-";

      result.push({ word, type, level, ox3000, ox5000, pronounce });
    }
  }

  fs.writeFile(
    path.join(__dirname, "words.json"),
    JSON.stringify(result),
    function (err) {
      if (err) throw err;
      console.log("Saved!");
    }
  );
});
