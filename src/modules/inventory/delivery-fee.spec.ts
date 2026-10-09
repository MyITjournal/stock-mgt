import { feeHasSomewhereToGo, splitDeliveryFee } from './delivery-fee';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('splitDeliveryFee', () => {
  it('puts the whole fee on a single line: 10 items, ₦5,000 → ₦500 each', () => {
    const [share] = splitDeliveryFee(500_000, [
      { totalCost: 10_000_000, quantityReceived: 10 },
    ]);
    expect(share).toBe(500_000);
    // The lot then costs ₦105,000 for ten: ₦10,500 each.
    expect((10_000_000 + share) / 10).toBe(1_050_000);
  });

  it('splits by value, and the kobo left over go to the largest remainders', () => {
    // ₦200,000 and ₦100,000 share ₦5,000: 333,333.33… and 166,666.66… kobo.
    const shares = splitDeliveryFee(500_000, [
      { totalCost: 20_000_000, quantityReceived: 20 },
      { totalCost: 10_000_000, quantityReceived: 5 },
    ]);
    expect(shares).toEqual([333_333, 166_667]);
    expect(sum(shares)).toBe(500_000);
  });

  it('always adds up to exactly the fee, whatever the values', () => {
    const lines = [
      { totalCost: 1, quantityReceived: 1 },
      { totalCost: 1, quantityReceived: 1 },
      { totalCost: 1, quantityReceived: 1 },
    ];
    const shares = splitDeliveryFee(100, lines);
    expect(sum(shares)).toBe(100);
    // A tie goes to the earlier line.
    expect(shares).toEqual([34, 33, 33]);
  });

  it('stays exact past what a double holds', () => {
    const shares = splitDeliveryFee(5_000_000, [
      { totalCost: 2_000_000_003, quantityReceived: 100 },
      { totalCost: 1_000_000_001, quantityReceived: 50 },
    ]);
    expect(sum(shares)).toBe(5_000_000);
    expect(shares[0]).toBe(3_333_333);
  });

  it('splits by what arrived when every line is free goods', () => {
    const shares = splitDeliveryFee(30_000, [
      { totalCost: 0, quantityReceived: 1 },
      { totalCost: 0, quantityReceived: 2 },
    ]);
    expect(shares).toEqual([10_000, 20_000]);
  });

  it('gives nothing to a line where nothing arrived', () => {
    const shares = splitDeliveryFee(30_000, [
      { totalCost: 0, quantityReceived: 0 },
      { totalCost: 5_000, quantityReceived: 2 },
    ]);
    expect(shares).toEqual([0, 30_000]);
  });

  it('gives a free line nothing when other lines have value', () => {
    expect(
      splitDeliveryFee(1_000, [
        { totalCost: 0, quantityReceived: 4 },
        { totalCost: 9_000, quantityReceived: 1 },
      ]),
    ).toEqual([0, 1_000]);
  });

  it('is all zeros when there is no fee', () => {
    expect(
      splitDeliveryFee(0, [{ totalCost: 5_000, quantityReceived: 2 }]),
    ).toEqual([0]);
  });

  it('knows when nothing arrived for a fee to be part of', () => {
    expect(feeHasSomewhereToGo([{ quantityReceived: 0 }])).toBe(false);
    expect(feeHasSomewhereToGo([{ quantityReceived: 3 }])).toBe(true);
  });
});
