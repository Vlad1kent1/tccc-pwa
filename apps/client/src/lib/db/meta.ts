import { formatHlc, initialHlc, newId, tickHlc } from "@tccc/shared";
import type { TcccDB } from "./schema";
import type { MetaEntry, MetaKey, MetaValues } from "./types";

export async function getMeta<K extends MetaKey>(db: TcccDB, key: K): Promise<MetaValues[K] | undefined> {
  const entry = await db.meta.get(key);
  return entry?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends MetaKey>(db: TcccDB, key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value } as MetaEntry);
}

/** Stable per-installation id; also the HLC node id. Generated on first use. */
export async function getDeviceId(db: TcccDB): Promise<string> {
  return db.transaction("rw", db.meta, async () => {
    const existing = await getMeta(db, "deviceId");
    if (existing) return existing;
    const deviceId = newId();
    await setMeta(db, "deviceId", deviceId);
    return deviceId;
  });
}

export async function getLastPullSeq(db: TcccDB): Promise<string> {
  return (await getMeta(db, "lastPullSeq")) ?? "0";
}

export async function setLastPullSeq(db: TcccDB, seq: string): Promise<void> {
  await setMeta(db, "lastPullSeq", seq);
}

export async function getServerClockOffset(db: TcccDB): Promise<number> {
  return (await getMeta(db, "serverClockOffsetMs")) ?? 0;
}

export async function getResponderProfile(db: TcccDB): Promise<MetaValues["responderProfile"] | undefined> {
  return getMeta(db, "responderProfile");
}

export async function setResponderProfile(db: TcccDB, profile: MetaValues["responderProfile"]): Promise<void> {
  await setMeta(db, "responderProfile", profile);
}

/**
 * Advances and persists the device HLC. Must be called inside a transaction that
 * includes `db.meta`, so the clock and the write it stamps commit together.
 */
export async function nextHlc(db: TcccDB, physicalNow: number): Promise<string> {
  const deviceId = await getDeviceId(db);
  const state = (await getMeta(db, "hlcState")) ?? initialHlc(deviceId);
  const next = tickHlc(state, physicalNow);
  await setMeta(db, "hlcState", next);
  return formatHlc(next);
}
