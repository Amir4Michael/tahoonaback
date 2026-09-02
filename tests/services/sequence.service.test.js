import { describe, it, expect, vi, beforeEach } from 'vitest';

const counterMocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn() }));
vi.mock('../../src/models/Counter.js', () => ({
  default: { findOneAndUpdate: (...args) => counterMocks.findOneAndUpdate(...args) },
}));

import { nextSequence } from '../../src/services/sequence.service.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nextSequence', () => {
  it('formats the returned counter value with the given prefix', async () => {
    counterMocks.findOneAndUpdate.mockResolvedValue({ value: 1001 });
    const result = await nextSequence('invoiceNumber', 'INV');
    expect(result).toBe('INV-1001');
  });

  it('atomically increments by 1 via $inc, with upsert so a first-ever call still works', async () => {
    counterMocks.findOneAndUpdate.mockResolvedValue({ value: 1 });
    await nextSequence('purchaseNumber', 'PUR');
    expect(counterMocks.findOneAndUpdate).toHaveBeenCalledWith(
      { name: 'purchaseNumber' },
      { $inc: { value: 1 } },
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('forwards a transaction session when given one', async () => {
    counterMocks.findOneAndUpdate.mockResolvedValue({ value: 2 });
    const fakeSession = { id: 'fake-session' };
    await nextSequence('invoiceNumber', 'INV', fakeSession);
    expect(counterMocks.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ session: fakeSession }),
    );
  });

  it('uses separate counters per name (invoiceNumber vs purchaseNumber never collide)', async () => {
    counterMocks.findOneAndUpdate.mockResolvedValueOnce({ value: 5 }).mockResolvedValueOnce({ value: 5 });
    const inv = await nextSequence('invoiceNumber', 'INV');
    const pur = await nextSequence('purchaseNumber', 'PUR');
    expect(inv).toBe('INV-5');
    expect(pur).toBe('PUR-5');
    expect(counterMocks.findOneAndUpdate.mock.calls[0][0]).toEqual({ name: 'invoiceNumber' });
    expect(counterMocks.findOneAndUpdate.mock.calls[1][0]).toEqual({ name: 'purchaseNumber' });
  });
});
