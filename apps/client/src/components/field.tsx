import type { ReactNode } from "react";

export const fieldClass = "input";

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="relative z-0 flex flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="error-text">{error}</span> : null}
    </label>
  );
}
