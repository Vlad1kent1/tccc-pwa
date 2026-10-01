"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { FIELD_TIPS } from "./field-tips";
import {
  SheetScope,
  useChecked,
  useExclusive,
  useFieldId,
  useTextValue,
} from "./form-context";
import { FRAME, pt, rect, textOrigin } from "./geometry";
import type { InjurySite } from "./injury-sites";

type Weight = "bold" | "normal";
type Box = readonly [x0: number, y0: number, x1: number, y1: number];

const WEIGHT_CLASS: Record<Weight, string> = { bold: "font-bold", normal: "font-normal" };

function faceClass(weight: Weight | undefined, italic: boolean | undefined): string {
  const slant = italic === undefined ? "" : italic ? "italic" : "not-italic";
  return [weight ? WEIGHT_CLASS[weight] : "", slant].filter(Boolean).join(" ");
}

export function Sheet({ label, children }: { label: string; children: ReactNode }) {
  const style = {
    aspectRatio: `${FRAME.width} / ${FRAME.height}`,
    "--pt": `calc(100cqw / ${FRAME.width})`,
  } as CSSProperties;
  return (
    <div className="@container min-w-0 w-full print:w-[428pt] print:break-inside-avoid">
      <SheetScope>
        <section
          aria-label={label}
          className="dd-sheet relative w-full overflow-hidden bg-white text-black"
          style={style}
        >
          {children}
        </section>
      </SheetScope>
    </div>
  );
}

/**
 * Printed text placed by its PDF origin. `size` is the largest size on the line
 * (drop caps included); smaller pieces go in <Run>.
 */
export function Text({
  x,
  y,
  size,
  weight = "bold",
  italic = false,
  as: Tag = "span",
  labelFor,
  children,
}: {
  x: number;
  y: number;
  size: number;
  weight?: Weight;
  italic?: boolean;
  as?: "span" | "h1" | "h2";
  labelFor?: string;
  children: ReactNode;
}) {
  const fieldId = useFieldId(labelFor ?? "");
  const className = `absolute whitespace-pre leading-none ${faceClass(weight, italic)}`;
  const style = textOrigin(x, y, size);
  if (labelFor) {
    return (
      <label htmlFor={fieldId} className={`${className} cursor-pointer`} style={style}>
        {children}
      </label>
    );
  }
  return (
    <Tag className={className} style={style}>
      {children}
    </Tag>
  );
}

export function Run({
  size,
  weight,
  italic,
  children,
}: {
  size: number;
  weight?: Weight;
  italic?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={faceClass(weight, italic) || undefined} style={{ fontSize: pt(size) }}>
      {children}
    </span>
  );
}

export function HRule({ x1, x2, y, width = 0.5 }: { x1: number; x2: number; y: number; width?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute border-black"
      style={{
        left: pt(x1 - FRAME.x),
        width: pt(x2 - x1),
        top: pt(y - FRAME.y - width / 2),
        borderTopWidth: pt(width),
      }}
    />
  );
}

export function VRule({ x, y1, y2, width = 0.5 }: { x: number; y1: number; y2: number; width?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute border-black"
      style={{
        left: pt(x - FRAME.x - width / 2),
        top: pt(y1 - FRAME.y),
        height: pt(y2 - y1),
        borderLeftWidth: pt(width),
      }}
    />
  );
}

/** Alternating gray of the official tables (`0.89` in the PDF). */
export function Shade({ box }: { box: Box }) {
  return <div aria-hidden className="pointer-events-none absolute bg-[#e3e3e3]" style={rect(...box)} />;
}

export function Table({
  xs,
  ys,
  stroke = 0.5,
}: {
  xs: readonly number[];
  ys: readonly number[];
  stroke?: number;
}) {
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  return (
    <>
      {ys.map((y) => (
        <HRule key={`h${y}`} x1={x0} x2={x1} y={y} width={stroke} />
      ))}
      {xs.map((x) => (
        <VRule key={`v${x}`} x={x} y1={y0} y2={y1} width={stroke} />
      ))}
    </>
  );
}

/** 0.5 pt rule with the form's [2 1] dash pattern. */
export function DashedRule({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <div
      aria-hidden
      className="dd-dash pointer-events-none absolute"
      style={{ left: pt(x1 - FRAME.x), width: pt(x2 - x1), top: pt(y - FRAME.y - 0.25) }}
    />
  );
}

/** Chamfered 1.5 pt card outline. Rendered last so it sits over table shading, as in the PDF. */
export function CardOutline() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`${FRAME.x} ${FRAME.y} ${FRAME.width} ${FRAME.height}`}
    >
      <polygon
        fill="none"
        stroke="#000"
        strokeWidth={1.5}
        points="45,50.4 383.4,50.4 397.8,64.8 397.8,576 383.4,590.4 45,590.4 30.6,576 30.6,64.8"
      />
    </svg>
  );
}

export function Tick({
  name,
  x,
  y,
  label,
  labelX,
  labelY,
  size = 11,
}: {
  name: string;
  x: number;
  y: number;
  label: string;
  labelX: number;
  labelY: number;
  size?: number;
}) {
  return (
    <span className="contents">
      <CheckBox name={name} x={x} y={y} />
      <Text x={labelX} y={labelY} size={size} labelFor={name}>
        {label}
      </Text>
    </span>
  );
}

export function CheckBox({ name, x, y }: { name: string; x: number; y: number }) {
  const id = useFieldId(name);
  const [checked, setChecked] = useChecked(name);
  return (
    <input
      id={id}
      type="checkbox"
      className="dd-box absolute"
      style={rect(x, y, x + 10, y + 10)}
      title={FIELD_TIPS[name]}
      checked={checked}
      onChange={(event) => setChecked(event.target.checked)}
    />
  );
}

/** A box from a mutually exclusive set; clicking the checked box clears the set. */
export function ChoiceBox({
  name,
  group,
  members,
  x,
  y,
}: {
  name: string;
  group: string;
  members: readonly string[];
  x: number;
  y: number;
}) {
  const id = useFieldId(name);
  const groupName = useFieldId(group);
  const [checked, setChecked] = useExclusive(name, members);
  return (
    <input
      id={id}
      type="radio"
      name={groupName}
      className="dd-box absolute"
      style={rect(x, y, x + 10, y + 10)}
      title={FIELD_TIPS[name]}
      checked={checked}
      onChange={() => setChecked(true)}
      onClick={() => {
        if (checked) setChecked(false);
      }}
    />
  );
}

/** Invisible injury-site box over the body figure; shows a heavy X when marked. */
export function InjuryMark({ site }: { site: InjurySite }) {
  const id = useFieldId(site.id);
  const [checked, setChecked] = useChecked(site.id);
  return (
    <input
      id={id}
      type="checkbox"
      className="dd-mark absolute"
      style={rect(site.x, site.y, site.x + site.size, site.y + site.size)}
      title={site.label}
      checked={checked}
      onChange={(event) => setChecked(event.target.checked)}
    />
  );
}

/** Position either by PDF rectangle or, inside table cells, by an explicit style. */
function placement(box: Box | undefined, style: CSSProperties | undefined): CSSProperties | undefined {
  return box ? rect(...box) : style;
}

export function TextField({
  name,
  box,
  style,
  maxLength,
  inputMode,
}: {
  name: string;
  box?: Box;
  style?: CSSProperties;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  return (
    <input
      id={id}
      type="text"
      size={1}
      autoComplete="off"
      spellCheck={false}
      className="dd-field absolute"
      style={placement(box, style)}
      title={FIELD_TIPS[name]}
      value={value}
      maxLength={maxLength}
      inputMode={inputMode}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

/** Drop-down list; the PDF's lists start with a blank entry. */
export function SelectField({
  name,
  options,
  fontSize = 10,
  box,
  style,
}: {
  name: string;
  options: readonly string[];
  fontSize?: number;
  box?: Box;
  style?: CSSProperties;
}) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  return (
    <select
      id={id}
      className="dd-field absolute"
      style={{ ...placement(box, style), fontSize: pt(fontSize) }}
      title={FIELD_TIPS[name]}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    >
      <option value=""> </option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export function TextArea({ name, box }: { name: string; box: Box }) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  return (
    <textarea
      id={id}
      autoComplete="off"
      spellCheck={false}
      className="dd-field absolute"
      style={rect(...box)}
      title={FIELD_TIPS[name]}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
