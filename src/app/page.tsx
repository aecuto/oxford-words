"use client";

import {
  Card,
  Typography,
  Select,
  Option,
  Button,
  CardBody,
  Popover,
  PopoverHandler,
  PopoverContent,
} from "@material-tailwind/react";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Word, db } from "./db";
import wordsJson from "../../scrapper/words.json";
import { sample } from "lodash";
import Iframe from "react-iframe";
import { useHotkeys } from "react-hotkeys-hook";
import { useTheme } from "next-themes";
import { cx } from "@emotion/css";
import SwitchMode from "./components/switch-mode";

const FILTER = ["verb", "adjective", "noun", "adverb", "other"];
const LIST = ["Oxford 3000", "Oxford 5000 excluding Oxford 3000"];

export default function Home() {
  const [filter, setFilter] = useState("verb");
  const [list, setList] = useState("Oxford 3000");
  const [word, setWord] = useState<Word>();
  const [openPopover, setOpenPopover] = useState(false);
  const { theme } = useTheme();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const triggers = {
    onMouseEnter: () => setOpenPopover(true),
    onMouseLeave: () => setOpenPopover(false),
  };

  const words = useLiveQuery(async () => {
    const ox3000 = list === LIST[0];

    const data = await db.words
      .filter((word) => {
        let isFilter = false;
        if (filter === "other") {
          isFilter = !["verb", "adjective", "noun", "adverb"]?.includes(
            word.type
          );
        } else {
          isFilter = word.type === filter;
        }

        return word.ox3000 === ox3000 && !word.ok && isFilter;
      })
      .toArray();

    setWord(sample(data));

    return data;
  }, [filter, list]);

  const onClear = () => {
    db.words.clear();
    db.words.bulkAdd(wordsJson);
  };

  const onOkay = () => {
    if (!word) return;
    db.words.update(Number(word.id), { ok: true });
  };

  const onSkip = () => {
    setWord(sample(words));
  };

  const playAudio = () => {
    if (!word) return;
    new Audio(word.pronounce).play();
  };

  useHotkeys("a", () => onOkay());
  useHotkeys("d", () => onSkip());
  useHotkeys("space", () => playAudio());

  if (!isClient) {
    return (
      <div className="flex w-full h-screen items-center justify-center">
        <div className="loader"></div>
      </div>
    );
  }

  return (
    <div
      className={cx(`p-2 m-auto max-w-screen-md`, theme === "dark" && "dark")}
    >
      <SwitchMode />
      <div className="flex flex-wrap mb-5 gap-3 mt-12 lg:mt-5">
        <div className="w-72">
          <Select
            value={filter}
            onChange={(val) => setFilter(String(val))}
            size="lg"
            className="text-gray-900 dark:text-white/50 border-0 bg-white hover:bg-gray-50 shadow-sm dark:bg-gray-900 dark:hover:bg-gray-800"
            labelProps={{ style: { display: "none" } }}
          >
            {FILTER.map((value) => (
              <Option key={value} value={value}>
                {value}
              </Option>
            ))}
          </Select>
        </div>
        <div className="w-72">
          <Select
            value={list}
            onChange={(val) => setList(String(val))}
            size="lg"
            className="text-gray-900 dark:text-white/50 border-0 bg-white hover:bg-gray-50 shadow-sm dark:bg-gray-900 dark:hover:bg-gray-800"
            labelProps={{ style: { display: "none" } }}
          >
            {LIST.map((value) => (
              <Option key={value} value={value}>
                {value}
              </Option>
            ))}
          </Select>
        </div>
        <Button
          onClick={() => onClear()}
          className="text-white w-20 bg-red-500 border border-red-600 shadow-md hover:bg-red-600 grow"
        >
          Reset
        </Button>
      </div>

      <Typography className="text-black dark:text-white/50 mb-6 pt-2 text-xl font-medium">
        Total Words: {words?.length}
      </Typography>

      <Button
        onClick={() => onOkay()}
        color="blue"
        className="mr-5 text-white bg-blue-500 border border-blue-600 hover:bg-blue-600"
      >
        OK
      </Button>
      <Button
        onClick={() => onSkip()}
        color="deep-orange"
        className="mr-5 text-white bg-orange-700 hover:bg-orange-800 border-orange-800"
      >
        Skip
      </Button>

      <Button onClick={() => playAudio()}>Play</Button>

      <Card className="mt-6 text-gray-900 bg-white border dark:text-white/50 dark:border-none dark:bg-gray-900 mb-5 shadow-md ">
        <CardBody>
          <Popover open={openPopover} handler={setOpenPopover}>
            <PopoverHandler {...triggers}>
              <Typography
                variant="h2"
                className="mb-2 cursor-help max-w-fit hover:text-gray-800 dark:hover:text-white"
              >
                {word?.word || "-"}
              </Typography>
            </PopoverHandler>
            <PopoverContent
              {...triggers}
              className="z-50 w-full  max-w-screen-md bg-white/90"
            >
              <Iframe
                url={`https://dict.longdo.com/mobile.php?search=${word?.word}`}
                className="w-full aspect-video"
              />
            </PopoverContent>
          </Popover>

          <Typography>level: {word?.level}</Typography>
          <Typography>type: {word?.type}</Typography>
        </CardBody>
      </Card>

      <div className="text-black dark:text-white/50">
        <Typography className="text-lg mb-2 font-medium">Shortcuts</Typography>
        <Typography>
          press <span className="font-bold text-xl">(A)</span> : OK
        </Typography>
        <Typography>
          press <span className="font-bold text-xl">(D)</span> : Skip
        </Typography>
        <Typography>
          press <span className="font-bold text-xl">(Space)</span> : Pronounce
        </Typography>
      </div>
    </div>
  );
}
