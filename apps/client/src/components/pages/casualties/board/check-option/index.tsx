"use client";

export function CheckOption({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm font-medium ${checked ? "border-accent bg-accent/15" : "border-border bg-background"}`}
    >
      <input type="checkbox" className="size-5 shrink-0" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
