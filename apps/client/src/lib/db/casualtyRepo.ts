import {
  CARD_FIELDS,
  CHILD_COLLECTIONS,
  cardFieldsSchema,
  cardPatchSchema,
  childSchemas,
  completeChildSchemas,
  emptyCardFields,
  mutationSchema,
  newId,
  tourniquetId,
  type CardField,
  type CardPatch,
  type ChildEntity,
  type ChildRowByEntity,
  type Mutation,
} from "@tccc/shared";
import { getNetworkAdjustedTime } from "../network-clock";
import { activeFlag, db as defaultDb, type TcccDB } from "./schema";
import { getDeviceId, getMeta, nextHlc, setMeta } from "./meta";
import type { LocalCasualtyCard, OutboxMutation } from "./types";

/** Child row as entered in a form; the repository fills in ownership and sync metadata. */
export type ChildInput<E extends ChildEntity> = Omit<
  ChildRowByEntity[E],
  "id" | "cardId" | "clientUpdatedAt" | "deletedAt"
> & { id?: string };

export class CardNotFoundError extends Error {
  constructor(id: string) {
    super(`Casualty card ${id} does not exist or was deleted`);
    this.name = "CardNotFoundError";
  }
}

const isoNow = (ms: number) => new Date(ms).toISOString();

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type BuiltChild<E extends ChildEntity> = { ok: true; row: ChildRowByEntity[E] } | { ok: false; error: unknown };

/**
 * The row `upsertChild` stores and syncs. An unfinished vitals, fluid, or
 * medication row is a valid row, as on the paper card. Fails when the input is invalid.
 */
function buildChildRow<E extends ChildEntity>(cardId: string, entity: E, input: ChildInput<E>, hlc: string): BuiltChild<E> {
  const id =
    entity === "tourniquet"
      ? tourniquetId(cardId, (input as unknown as ChildInput<"tourniquet">).limb)
      : (input.id ?? newId());
  const parsed = childSchemas[entity].safeParse({ ...input, id, cardId, clientUpdatedAt: hlc, deletedAt: null });
  return parsed.success ? { ok: true, row: parsed.data as ChildRowByEntity[E] } : { ok: false, error: parsed.error };
}

/** Child entities whose rows may be unfinished. Rows of the other entities were always complete. */
const PARTIAL_ENTITIES = ["vitalSigns", "fluid", "medication"] as const;

/** Any well-formed clock; `buildChildRow` only needs it to pass the schema. */
const PROBE_HLC = "0000000000000:0000:probe";

/** True when `upsertChild` would accept this input. Callers check first so one bad row does not roll back a whole save. */
export function isStorableChild<E extends ChildEntity>(cardId: string, entity: E, input: ChildInput<E>): boolean {
  return buildChildRow(cardId, entity, input, PROBE_HLC).ok;
}

/**
 * Repository over the local card store (PLAN.md 3.6, 4.2). Every write runs in one
 * Dexie transaction that updates the aggregate, stamps it with a fresh HLC and
 * appends exactly one outbox mutation, so a crash never leaves them out of step.
 */
export function createCasualtyRepo(db: TcccDB = defaultDb, now: () => number = getNetworkAdjustedTime) {
  const writeTables = [db.casualties, db.outbox, db.meta] as const;

  async function enqueue(mutation: Mutation, at: number): Promise<void> {
    const entry: OutboxMutation = {
      ...mutationSchema.parse(mutation),
      status: "queued",
      attempts: 0,
      createdAt: at,
    };
    await db.outbox.add(entry);
  }

  async function loadActive(id: string): Promise<LocalCasualtyCard> {
    const card = await db.casualties.get(id);
    if (!card || card.deletedAt) throw new CardNotFoundError(id);
    return card;
  }

  function touch(card: LocalCasualtyCard, hlc: string): LocalCasualtyCard {
    return {
      ...card,
      clientUpdatedAt: hlc,
      // An unresolved conflict stays visible until the user resolves it in Settings.
      syncStatus: card.syncStatus === "conflict" ? "conflict" : "pending",
      active: activeFlag(card.deletedAt),
    };
  }

  async function create(initial: CardPatch = {}): Promise<LocalCasualtyCard> {
    const fields = cardFieldsSchema.parse({ ...emptyCardFields(), ...cardPatchSchema.parse(initial) });
    return db.transaction("rw", writeTables, async () => {
      const at = now();
      const hlc = await nextHlc(db, at);
      const card: LocalCasualtyCard = {
        id: newId(),
        ...fields,
        injurySites: [],
        tourniquets: [],
        vitalSigns: [],
        fluids: [],
        medications: [],
        fieldClock: Object.fromEntries(CARD_FIELDS.map((f) => [f, hlc])),
        syncStatus: "pending",
        serverVersion: null,
        changeSeq: null,
        createdByDeviceId: await getDeviceId(db),
        createdAt: isoNow(at),
        clientUpdatedAt: hlc,
        serverUpdatedAt: null,
        deletedAt: null,
        active: 1,
      };
      await db.casualties.add(card);
      // The first push carries every field so the server can create the full row.
      await enqueue(
        {
          op: "card.upsert",
          mutationId: newId(),
          cardId: card.id,
          hlc,
          baseVersion: null,
          patch: fields,
          changedFields: [...CARD_FIELDS],
        },
        at,
      );
      return card;
    });
  }

  async function updateFields(id: string, patch: CardPatch): Promise<LocalCasualtyCard> {
    const parsed = cardPatchSchema.parse(patch);
    return db.transaction("rw", writeTables, async () => {
      const card = await loadActive(id);
      const changed = (Object.keys(parsed) as CardField[]).filter((f) => !sameValue(card[f], parsed[f]));
      if (changed.length === 0) return card;

      const effective = Object.fromEntries(changed.map((f) => [f, parsed[f]])) as CardPatch;
      const at = now();
      const hlc = await nextHlc(db, at);
      const fieldClock = { ...card.fieldClock };
      for (const f of changed) fieldClock[f] = hlc;

      const next = touch({ ...card, ...effective, fieldClock }, hlc);
      cardFieldsSchema.parse(next);
      await db.casualties.put(next);
      await enqueue(
        {
          op: "card.upsert",
          mutationId: newId(),
          cardId: id,
          hlc,
          baseVersion: card.serverVersion,
          patch: effective,
          changedFields: changed,
        },
        at,
      );
      return next;
    });
  }

  async function upsertChild<E extends ChildEntity>(
    cardId: string,
    entity: E,
    input: ChildInput<E>,
  ): Promise<ChildRowByEntity[E]> {
    return db.transaction("rw", writeTables, async () => {
      const card = await loadActive(cardId);
      const at = now();
      const hlc = await nextHlc(db, at);
      const built = buildChildRow(cardId, entity, input, hlc);
      if (!built.ok) {
        throw built.error ?? new Error(`Invalid ${entity} row`);
      }
      const { row } = built;

      const key = CHILD_COLLECTIONS[entity];
      const rows = card[key] as ChildRowByEntity[E][];
      const index = rows.findIndex((r) => r.id === row.id);
      const nextRows = index === -1 ? [...rows, row] : rows.map((r, i) => (i === index ? row : r));

      await db.casualties.put(touch({ ...card, [key]: nextRows }, hlc));
      await enqueue(
        {
          op: "child.upsert",
          entity,
          row,
          mutationId: newId(),
          cardId,
          hlc,
          baseVersion: card.serverVersion,
        } as Mutation,
        at,
      );
      return row;
    });
  }

  async function deleteChild(cardId: string, entity: ChildEntity, entityId: string): Promise<void> {
    await db.transaction("rw", writeTables, async () => {
      const card = await loadActive(cardId);
      const key = CHILD_COLLECTIONS[entity];
      const rows = card[key] as { id: string; deletedAt: string | null }[];
      const existing = rows.find((r) => r.id === entityId);
      if (!existing || existing.deletedAt) return;

      const at = now();
      const hlc = await nextHlc(db, at);
      const deletedAt = isoNow(at);
      // Tombstone rather than remove, so the deletion can win or lose by HLC on the server.
      const nextRows = rows.map((r) => (r.id === entityId ? { ...r, deletedAt, clientUpdatedAt: hlc } : r));

      await db.casualties.put(touch({ ...card, [key]: nextRows }, hlc));
      // Always sent: any row may be on the server, unfinished or not. A row the server
      // never saw answers NOT_FOUND, which the push treats as done.
      await enqueue(
        {
          op: "child.delete",
          entity,
          entityId,
          deletedAt,
          mutationId: newId(),
          cardId,
          hlc,
          baseVersion: card.serverVersion,
        },
        at,
      );
    });
  }

  async function softDelete(id: string): Promise<void> {
    await db.transaction("rw", writeTables, async () => {
      const card = await loadActive(id);
      const at = now();
      const hlc = await nextHlc(db, at);
      const deletedAt = isoNow(at);
      await db.casualties.put(touch({ ...card, deletedAt, fieldClock: { ...card.fieldClock, deletedAt: hlc } }, hlc));
      await enqueue(
        { op: "card.delete", deletedAt, mutationId: newId(), cardId: id, hlc, baseVersion: card.serverVersion },
        at,
      );
    });
  }

  async function getById(id: string): Promise<LocalCasualtyCard | undefined> {
    return db.casualties.get(id);
  }

  async function listActive(): Promise<LocalCasualtyCard[]> {
    return db.casualties.where("active").equals(1).toArray();
  }

  function readWrite<T>(work: () => Promise<T>): Promise<T> {
    return db.transaction("rw", writeTables, work);
  }

  /**
   * Once per install: before unfinished rows could sync, a vitals, fluid, or
   * medication row that was not complete stayed on this device, and deleting such
   * a row sent nothing, so the server kept it and it came back. Queues each of
   * those rows, or its deletion, so the server catches up. Returns how many cards.
   */
  async function queueUnsyncedRows(): Promise<number> {
    if (await getMeta(db, "unsyncedRowsQueued")) return 0;
    let cards = 0;
    for (const { id } of await db.casualties.toArray()) {
      cards += await db.transaction("rw", writeTables, async () => {
        const card = await db.casualties.get(id);
        if (!card || card.deletedAt) return 0;
        let next = card;
        let lastHlc: string | null = null;
        for (const entity of PARTIAL_ENTITIES) {
          const key = CHILD_COLLECTIONS[entity];
          for (const row of card[key] as ChildRowByEntity[typeof entity][]) {
            // A complete row, and the deletion of one, were queued when they were written.
            if (completeChildSchemas[entity].safeParse(row).success) continue;
            if (!childSchemas[entity].safeParse(row).success) continue;
            const at = now();
            const hlc = await nextHlc(db, at);
            lastHlc = hlc;
            const base = { mutationId: newId(), cardId: id, hlc, baseVersion: card.serverVersion };
            if (row.deletedAt) {
              await enqueue({ ...base, op: "child.delete", entity, entityId: row.id, deletedAt: row.deletedAt }, at);
              continue;
            }
            const stamped = { ...row, clientUpdatedAt: hlc };
            const rows = next[key] as ChildRowByEntity[typeof entity][];
            next = { ...next, [key]: rows.map((item) => (item.id === row.id ? stamped : item)) };
            await enqueue({ ...base, op: "child.upsert", entity, row: stamped } as Mutation, at);
          }
        }
        if (!lastHlc) return 0;
        await db.casualties.put(touch(next, lastHlc));
        return 1;
      });
    }
    await setMeta(db, "unsyncedRowsQueued", true);
    return cards;
  }

  return { create, updateFields, upsertChild, deleteChild, softDelete, getById, listActive, readWrite, queueUnsyncedRows };
}

export type CasualtyRepo = ReturnType<typeof createCasualtyRepo>;

export const casualtyRepo = createCasualtyRepo();
