/** Whether the browser refused persistent storage; the app shell shows a banner while it is true. */
let denied = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPersistenceDenied(value: boolean): void {
  denied = value;
  emit();
}

export function subscribePersistenceDenied(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPersistenceDenied(): boolean {
  return denied;
}
