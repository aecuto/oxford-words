import { cx } from "@emotion/css";

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[] | string[];
  className?: string;
  disabled?: boolean;
};

export function Select({
  value,
  onChange,
  options,
  className,
  disabled = false,
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cx(
        "w-full px-3 py-3 rounded-lg shadow-sm cursor-pointer",
        "text-gray-900 dark:text-white/50",
        "bg-white dark:bg-gray-900",
        "border border-gray-300 dark:border-gray-700",
        "hover:bg-gray-50 dark:hover:bg-gray-800",
        "focus:outline-none focus:ring-2 focus:ring-blue-500",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
