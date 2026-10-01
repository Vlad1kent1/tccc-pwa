import { describe, expect, it } from 'vitest';
import { mergeChildRow, mergeField, mergeTombstone, type ChildClockRow } from './merge.js';

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

  it('treats a missing stored clock as older than the incoming write', () => {
    const result = mergeField({
      entity: 'card',
      entityId: CARD,
      field: 'notes',
      stored: null,
      incoming: 'TQ on right arm',
      storedClock: null,
      incomingClock: OLD,
    });

    expect(result.value).toBe('TQ on right arm');
    expect(result.discarded).toMatchObject({ discarded: null, kept: 'TQ on right arm' });
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
    const incoming = { ...stored, clientUpdatedAt: OLD, pulseRate: 40 };
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
