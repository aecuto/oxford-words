import { ReactNode } from "react";
import { cx } from "@emotion/css";

type CardProps = {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
};

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "bg-white dark:bg-gray-900 rounded-xl shadow-md",
        className
      )}
    >
      {children}
    </div>
  );
}

type CardBodyProps = {
  children: ReactNode;
  className?: string;
};

export function CardBody({ children, className }: CardBodyProps) {
  return <div className={cx("p-4", className)}>{children}</div>;
}
