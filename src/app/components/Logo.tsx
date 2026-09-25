import { cx } from "@emotion/css";

type LogoProps = {
  size?: "lg" | "sm";
  className?: string;
};

export function Logo({ size = "lg", className }: LogoProps) {
  if (size === "sm") {
    return (
      <div className={cx("text-center select-none", className)}>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-500 dark:text-gray-400 leading-none">
          Battle
        </p>
        <div className="text-lg font-black tracking-wide leading-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Oxford Words
        </div>
      </div>
    );
  }
  return (
    <div className={cx("text-center", className)}>
      <p className="text-xs sm:text-sm font-black uppercase tracking-[0.3em] text-gray-500">
        BATTLE
      </p>
      <h1 className="text-4xl sm:text-5xl font-black tracking-wide leading-none mt-1.5 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent select-none">
        Oxford Words
      </h1>
    </div>
  );
}
