// @vitest-environment happy-dom
import { act, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { casualtyRepo, db } from "@/lib/db";

const renders = vi.hoisted(() => ({ injury: 0 }));
const search = vi.hoisted(() => ({ id: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ id: search.id }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: () => <span data-image="" /> }));
vi.mock("@/components/pages/casualties/dd1380/fonts", () => ({ formSans: { variable: "" }, formSerif: { variable: "" } }));
// The real injury section, inside a Profiler that counts every commit of it or anything below it.
vi.mock("@/components/pages/casualties/dd1380/injury-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/pages/casualties/dd1380/injury-section")>();
  const Real = actual.InjurySection;
  return {
    ...actual,
    InjurySection: () => (
      <Profiler id="injury" onRender={() => void (renders.injury += 1)}>
        <Real />
      </Profiler>
    ),
  };
});

import { CardView } from "@/components/pages/casualties/card-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

let root: Root;
let container: HTMLElement;
let cardId: string;

beforeEach(async () => {
  const card = await casualtyRepo.create({ lastName: "Adler" });
  cardId = card.id;
  search.id = card.id;
  renders.injury = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CardView />));
  await vi.waitFor(() => expect(nameInput()).not.toBeNull());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await casualtyRepo.softDelete(cardId).catch(() => undefined);
});

afterAll(() => {
  db.close();
});

function nameInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('[data-testid="patient-name-input"]');
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  for (let length = 1; length <= text.length; length += 1) {
    await act(async () => {
      setInputValue.call(input, text.slice(0, length));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

describe("DD1380 sheet re-renders", () => {
  it("does not re-render the injury figures while a text field is typed in and saved", async () => {
    const before = renders.injury;
    expect(before).toBeGreaterThan(0);

    await type(nameInput()!, "Kovalenko");
    expect(nameInput()!.value).toBe("Kovalenko");
    // Through the debounced save and the card coming back from IndexedDB.
    await vi.waitFor(async () => expect((await casualtyRepo.getById(cardId))?.lastName).toBe("Kovalenko"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(nameInput()!.value).toBe("Kovalenko");
    expect(renders.injury).toBe(before);
  });

  it("says on the card when a table holds more rows than it prints", async () => {
    for (let hour = 8; hour <= 12; hour += 1) {
      await casualtyRepo.upsertChild(cardId, "medication", {
        category: "ANALGESIC",
        name: `Dose ${hour}`,
        dose: "50 mg",
        route: "IM",
        administeredAt: new Date(2026, 9, 1, hour, 0).toISOString(),
      });
    }

    await vi.waitFor(() => expect(container.textContent).toContain("NOT ON THIS CARD: analgesic +1. See the digital record."));
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
  });

  it("re-renders them when an injury target is checked", async () => {
    const before = renders.injury;
    const target = container.querySelector<HTMLInputElement>('input.dd-mark[type="checkbox"]')!;

    await act(async () => target.click());

    expect(target.checked).toBe(true);
    expect(renders.injury).toBeGreaterThan(before);
  });
});
