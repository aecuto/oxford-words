import { ReactNode } from "react";
import { cx } from "@emotion/css";

type TypographyProps = {
  children: ReactNode;
  className?: string;
  variant?: "h1" | "h2" | "h3" | "p";
};

export function Typography({
  children,
  className,
  variant = "p",
}: TypographyProps) {
  const baseClasses = "text-gray-900 dark:text-white/50";

  const variantClasses = {
    h1: "text-3xl font-bold",
    h2: "text-2xl font-semibold",
    h3: "text-xl font-medium",
    p: "text-base",
  };

  const Tag = variant === "p" ? "p" : variant;

  return (
    <Tag className={cx(baseClasses, variantClasses[variant], className)}>
      {children}
    </Tag>
  );
}
