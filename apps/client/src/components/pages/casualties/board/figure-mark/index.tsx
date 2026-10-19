import type { ReactNode } from "react";
import { figureMarkStyle } from "@/components/pages/casualties/board/regions";

/** Centers an X on a 0–1 point inside a body figure. Edit and the DD1380 card share this frame. */
export function figureMarkClass(extra = ""): string {
  return `absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center font-black leading-none ${extra}`;
}

export function FigureMark({
  x,
  y,
  className = "",
  children = "X",
}: {
  x: number;
  y: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span aria-hidden className={figureMarkClass(`pointer-events-none ${className}`)} style={figureMarkStyle(x, y)}>
      {children}
    </span>
  );
}
