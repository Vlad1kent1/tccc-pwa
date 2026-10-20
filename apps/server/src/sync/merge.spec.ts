import { describe, expect, it } from 'vitest';
import {
  mergeCardDelete,
  mergeCardPatch,
  mergeChildDelete,
  mergeChildRow,
  mergeChildUpsert,
  mergeField,
  mergeTombstone,
  type ChildClockRow,
} from './merge.js';

const CARD = '0192f000-0000-7000-8000-000000000001';
const OLD = '1790000000000:0001:device-a';
const NEW = '1790000000000:0002:device-b';

describe('mergeField', () => {
  it('lets the newer clock replace the stored value and records the discarded one', () => {
    const result = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'evacPriority',
      stored: 'ROUTINE',
      incoming: 'URGENT',
      storedClock: OLD,
      incomingClock: NEW,
    });

    expect(result.value).toBe('URGENT');
    expect(result.clock).toBe(NEW);
    expect(result.discarded).toMatchObject({
      field: 'evacPriority',
      kept: 'URGENT',
      discarded: 'ROUTINE',
      incomingLost: false,
    });
  });

  it('keeps the stored value when the incoming clock is older', () => {
    const result = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'allergies',
      stored: 'Penicillin',
      incoming: 'NKA',
      storedClock: NEW,
      incomingClock: OLD,
    });

    expect(result.value).toBe('Penicillin');
    expect(result.clock).toBe(NEW);
    expect(result.discarded).toMatchObject({
      kept: 'Penicillin',
      discarded: 'NKA',
      incomingLost: true,
    });
  });

  it('treats a missing stored clock as older, and replacing that unwritten default is no conflict', () => {
    const result = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'allergies',
      stored: null,
      incoming: 'Penicillin',
      storedClock: null,
      incomingClock: OLD,
    });

    expect(result.value).toBe('Penicillin');
    expect(result.clock).toBe(OLD);
    expect(result.discarded).toBeNull();
  });

  it('does not record a conflict when both sides wrote the same value', () => {
    const result = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'evacPriority',
      stored: 'URGENT',
      incoming: 'URGENT',
      storedClock: OLD,
      incomingClock: NEW,
    });

    expect(result.value).toBe('URGENT');
    expect(result.discarded).toBeNull();
  });

  it('does not record a conflict when a device replaces, or replays over, its own value', () => {
    const later = '1790000000000:0005:device-a';
    const replaced = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'evacPriority',
      stored: null,
      incoming: 'ROUTINE',
      storedClock: OLD,
      incomingClock: later,
    });
    expect(replaced).toEqual({ value: 'ROUTINE', clock: later, discarded: null });

    const replayed = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'evacPriority',
      stored: 'ROUTINE',
      incoming: null,
      storedClock: later,
      incomingClock: OLD,
    });
    expect(replayed).toEqual({ value: 'ROUTINE', clock: later, discarded: null });
  });
});

describe('mergeChildRow', () => {
  const stored: ChildClockRow & { pulseRate: number } = {
    id: '0192f000-0000-7000-8000-000000000010',
    clientUpdatedAt: OLD,
    deletedAt: null,
    pulseRate: 90,
  };

  it('replaces the row when the incoming clock is newer', () => {
    const incoming = { ...stored, clientUpdatedAt: NEW, pulseRate: 120 };
    const result = mergeChildRow({ entity: 'vitalSigns', stored, incoming });

    expect(result.row.pulseRate).toBe(120);
    expect(result.discarded).toMatchObject({
      field: 'row',
      kept: incoming,
      discarded: stored,
      incomingLost: false,
    });
  });

  it('keeps the stored row when the incoming clock is not newer', () => {
    const incoming = { ...stored, clientUpdatedAt: '1789999999999:0001:device-b', pulseRate: 40 };
    const result = mergeChildRow({ entity: 'vitalSigns', stored, incoming });

    expect(result.row).toBe(stored);
    expect(result.discarded?.incomingLost).toBe(true);
  });

  it('inserts a row that the server has never seen', () => {
    const incoming = { ...stored, clientUpdatedAt: NEW };
    const result = mergeChildRow({ entity: 'vitalSigns', stored: null, incoming });

    expect(result.row).toBe(incoming);
    expect(result.discarded).toBeNull();
  });

  it('replaces a row the same device wrote without recording a conflict', () => {
    const incoming = { ...stored, clientUpdatedAt: '1790000000000:0005:device-a', pulseRate: 120 };
    const result = mergeChildRow({ entity: 'vitalSigns', stored, incoming });

    expect(result.row).toBe(incoming);
    expect(result.discarded).toBeNull();
  });
});

describe('mergeTombstone', () => {
  const stored: ChildClockRow = {
    id: '0192f000-0000-7000-8000-000000000010',
    clientUpdatedAt: OLD,
    deletedAt: null,
  };

  it('applies a newer tombstone', () => {
    const result = mergeTombstone({
      entity: 'vitalSigns',
      stored,
      deletedAt: '2026-09-24T12:00:00.000Z',
      hlc: NEW,
    });

    expect(result.row.deletedAt).toBe('2026-09-24T12:00:00.000Z');
    expect(result.row.clientUpdatedAt).toBe(NEW);
    expect(result.discarded).toMatchObject({ field: 'deletedAt', discarded: null });
  });

  it('keeps the row when an edit is newer than the tombstone', () => {
    const edited = { ...stored, clientUpdatedAt: NEW, deletedAt: null };
    const result = mergeTombstone({
      entity: 'vitalSigns',
      stored: edited,
      deletedAt: '2026-09-24T12:00:00.000Z',
      hlc: OLD,
    });

    expect(result.row.deletedAt).toBeNull();
    expect(result.discarded).toMatchObject({
      kept: null,
      discarded: '2026-09-24T12:00:00.000Z',
      incomingLost: true,
    });
  });
});

describe('fast path (base version matches)', () => {
  const ROW = '0192f000-0000-7000-8000-000000000010';

  it('drops an older offline edit instead of overwriting a newer value, and records it', () => {
    const result = mergeCardPatch({
      cardId: CARD,
      stored: { allergies: 'Penicillin', notes: 'old note' },
      storedClock: { allergies: NEW, notes: OLD },
      patch: { allergies: 'NKA', notes: 'new note' },
      changedFields: ['allergies', 'notes'],
      hlc: '1790000000000:0001:device-c',
      fastPath: true,
    });

    expect(result.columns).toEqual({ notes: 'new note' });
    expect(result.clock).toEqual({ allergies: NEW, notes: '1790000000000:0001:device-c' });
    expect(result.discarded).toEqual([
      expect.objectContaining({ field: 'allergies', kept: 'Penicillin', discarded: 'NKA', incomingLost: true }),
    ]);
  });

  it('applies a newer edit without recording the value it replaced as a conflict', () => {
    const result = mergeCardPatch({
      cardId: CARD,
      stored: { evacPriority: 'ROUTINE' },
      storedClock: { evacPriority: OLD },
      patch: { evacPriority: 'URGENT' },
      changedFields: ['evacPriority'],
      hlc: NEW,
      fastPath: true,
    });

    expect(result.columns).toEqual({ evacPriority: 'URGENT' });
    expect(result.discarded).toEqual([]);
  });

  it('still records the replaced value on the slow path, where the device had not seen it', () => {
    const result = mergeCardPatch({
      cardId: CARD,
      stored: { evacPriority: 'ROUTINE' },
      storedClock: { evacPriority: OLD },
      patch: { evacPriority: 'URGENT' },
      changedFields: ['evacPriority'],
      hlc: NEW,
      fastPath: false,
    });

    expect(result.discarded).toEqual([
      expect.objectContaining({ kept: 'URGENT', discarded: 'ROUTINE', incomingLost: false }),
    ]);
  });

  it('records nothing on the slow path when the device replaces the value it created the card with', () => {
    const result = mergeCardPatch({
      cardId: CARD,
      stored: { evacPriority: null },
      storedClock: { evacPriority: OLD },
      patch: { evacPriority: 'ROUTINE' },
      changedFields: ['evacPriority'],
      hlc: '1790000000000:0005:device-a',
      fastPath: false,
    });

    expect(result.columns).toEqual({ evacPriority: 'ROUTINE' });
    expect(result.discarded).toEqual([]);
  });

  it('does not delete a card whose restore is newer than the delete', () => {
    const result = mergeCardDelete({
      cardId: CARD,
      storedDeletedAt: null,
      storedClock: { deletedAt: NEW },
      deletedAt: '2026-09-24T12:00:00.000Z',
      hlc: OLD,
      fastPath: true,
    });

    expect(result.deletedAt).toBeNull();
    expect(result.clock.deletedAt).toBe(NEW);
    expect(result.discarded).toHaveLength(1);
  });

  it('deletes a card that never had a deletedAt clock without a review conflict', () => {
    const result = mergeCardDelete({
      cardId: CARD,
      storedDeletedAt: null,
      storedClock: {},
      deletedAt: '2026-09-24T12:00:00.000Z',
      hlc: OLD,
      fastPath: false,
    });

    expect(result.deletedAt).toBe('2026-09-24T12:00:00.000Z');
    expect(result.discarded).toEqual([]);
  });

  it('keeps a newer child row over an older upsert', () => {
    const stored = { id: ROW, clientUpdatedAt: NEW, deletedAt: null, pulseRate: 120 };
    const incoming = { id: ROW, clientUpdatedAt: OLD, deletedAt: null, pulseRate: 60 };
    const result = mergeChildUpsert({ entity: 'vitalSigns', stored, incoming, fastPath: true });

    expect(result.write).toBeNull();
    expect(result.discarded).toEqual([expect.objectContaining({ field: 'row', incomingLost: true })]);
  });

  it('writes a newer child row silently on the fast path', () => {
    const stored = { id: ROW, clientUpdatedAt: OLD, deletedAt: null, pulseRate: 120 };
    const incoming = { id: ROW, clientUpdatedAt: NEW, deletedAt: null, pulseRate: 60 };
    const result = mergeChildUpsert({ entity: 'vitalSigns', stored, incoming, fastPath: true });

    expect(result.write).toBe(incoming);
    expect(result.discarded).toEqual([]);
  });

  it('ignores an older delete of a row that was edited since', () => {
    const stored = { id: ROW, clientUpdatedAt: NEW, deletedAt: null };
    const result = mergeChildDelete({ entity: 'fluid', stored, deletedAt: '2026-09-24T12:00:00.000Z', hlc: OLD, fastPath: true });

    expect(result.write).toBeNull();
    expect(result.discarded).toEqual([expect.objectContaining({ field: 'deletedAt', incomingLost: true })]);
  });
});
