import type { ReactNode } from "react";

export const GRID = "border border-black";

export function EntryRows({
  label,
  rows,
  fields,
  shade = false,
  renderCell,
}: {
  label: ReactNode;
  rows: readonly { name: string; volume?: string; dose?: string; route: string; time: string }[];
  fields: readonly ["name", "volume" | "dose", "route", "time"];
  shade?: boolean;
  renderCell: (index: number, field: "name" | "volume" | "dose" | "route" | "time") => ReactNode;
}) {
  const tone = shade ? "bg-[#dcdcdc]" : "bg-white";
  return rows.map((row, index) => (
    <tr key={row.name} className={tone}>
      <td className="bg-white"/>
      {index === 0 ? (
        <td rowSpan={rows.length} className={`${GRID} ${tone} px-[0.2em] leading-tight`}>
          {label}
        </td>
      ) : null}
      {fields.map((field) => (
        <td key={field} className={`${GRID} ${tone}`}>
          {renderCell(index, field)}
        </td>
      ))}
    </tr>
  ));
}

export function Category({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <Stacked text={title} />
      {hint ? (
        <span className="mt-[0.1em] block text-[0.72em] leading-tight font-normal whitespace-pre-line italic">{hint}</span>
      ) : null}
    </>
  );
}

export function Stacked({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </>
  );
}
