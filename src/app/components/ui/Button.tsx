import { ReactNode } from "react";
import { cx } from "@emotion/css";

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
};

export function Button({
  children,
  onClick,
  className,
  type = "button",
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "px-6 py-3 rounded-lg font-medium transition-colors",
        "text-white bg-red-500 border border-red-600",
        "shadow-md hover:bg-red-600",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
