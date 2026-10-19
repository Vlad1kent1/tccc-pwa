import { compareHlc, formatHlc, initialHlc, newId, receiveHlc, tickHlc } from "@tccc/shared";
import { setServerClockOffset } from "../network-clock";
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

/** Loads the persisted server offset into `getNetworkAdjustedTime`. Call once at startup. */
export async function loadServerClockOffset(db: TcccDB): Promise<void> {
  setServerClockOffset(await getServerClockOffset(db));
}

/** Measures and persists the server offset from a response's `serverTime`. */
export async function rememberServerClock(db: TcccDB, serverMs: number, deviceMs = Date.now()): Promise<void> {
  const offset = serverMs - deviceMs;
  setServerClockOffset(offset);
  await setMeta(db, "serverClockOffsetMs", offset);
}

/**
 * Advances the device HLC past a clock it has seen, so any edit made after
 * seeing a value is newer than that value even when another device's clock runs
 * ahead. Must run inside a transaction that includes `db.meta`.
 */
export async function observeClock(db: TcccDB, clock: string, physicalNow: number): Promise<void> {
  const deviceId = await getDeviceId(db);
  const state = (await getMeta(db, "hlcState")) ?? initialHlc(deviceId);
  const next = receiveHlc(state, clock, physicalNow);
  if (compareHlc(formatHlc(next), formatHlc(state)) > 0) await setMeta(db, "hlcState", next);
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
