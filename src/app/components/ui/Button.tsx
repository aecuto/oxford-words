import { ReactNode } from "react";
import { cx } from "@emotion/css";

const VARIANTS = {
  primary: "bg-red-500 border-red-600 hover:bg-red-600",
  blue: "bg-blue-500 border-blue-600 hover:bg-blue-600",
  gray: "bg-gray-500 border-gray-600 hover:bg-gray-600",
  purple: "bg-purple-500 border-purple-600 hover:bg-purple-600",
} as const;

type ButtonVariant = keyof typeof VARIANTS;

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  variant?: ButtonVariant;
};

export function Button({
  children,
  onClick,
  className,
  type = "button",
  disabled = false,
  variant = "primary",
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "px-6 py-3 rounded-lg font-medium text-white border transition-colors touch-manipulation select-none",
        "shadow-md active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </button>
  );
}
