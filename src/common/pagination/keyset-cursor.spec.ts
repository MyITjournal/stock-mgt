import { BadRequestException } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  keysetWhereCreated,
  keysetWhereCreatedDesc,
  keysetWhereUpdated,
} from './keyset-cursor';

const AT = new Date('2026-09-25T10:00:00.000Z');
const CURSOR = { at: AT, id: 'row-5' };

describe('cursors round-trip', () => {
  it('survives encoding', () => {
    expect(decodeCursor(encodeCursor(CURSOR))).toEqual(CURSOR);
  });

  it('refuses something that is not a cursor', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
  });
});

describe('walking forward, for a syncing client', () => {
  it('takes rows strictly after the cursor, breaking ties on id', () => {
    expect(keysetWhereCreated(CURSOR)).toEqual([
      {
        OR: [{ createdAt: { gt: AT } }, { createdAt: AT, id: { gt: 'row-5' } }],
      },
    ]);
  });

  it('starts from `since` when there is no cursor', () => {
    expect(keysetWhereCreated(undefined, AT)).toEqual([
      { createdAt: { gt: AT } },
    ]);
  });

  /**
   * A cursor is more precise than a timestamp, and honouring both would
   * re-send the rows between them.
   */
  it('ignores `since` once a cursor exists', () => {
    expect(keysetWhereCreated(CURSOR, new Date(0))).toEqual(
      keysetWhereCreated(CURSOR),
    );
  });
});

describe('walking backward, for a person reading a list', () => {
  it('takes rows strictly before the cursor, breaking ties on id', () => {
    expect(keysetWhereCreatedDesc(CURSOR)).toEqual([
      {
        OR: [{ createdAt: { lt: AT } }, { createdAt: AT, id: { lt: 'row-5' } }],
      },
    ]);
  });

  /**
   * The direction is the whole point of this function existing, and getting it
   * backwards would page *away* from the rows the reader wants while still
   * returning plausible-looking results.
   */
  it('is the mirror of the forward walk, not a copy of it', () => {
    const forward = JSON.stringify(keysetWhereCreated(CURSOR));
    const backward = JSON.stringify(keysetWhereCreatedDesc(CURSOR));
    expect(backward).not.toEqual(forward);
    expect(backward).toContain('lt');
    expect(backward).not.toContain('gt');
  });

  /**
   * No cursor means start at the newest row. The date bounds a browser passes
   * are ordinary filters the caller applies, not a starting position — unlike
   * `since` on the forward walk.
   */
  it('starts at the newest row when there is no cursor', () => {
    expect(keysetWhereCreatedDesc(undefined)).toEqual([]);
  });
});

describe('walking a mutable feed', () => {
  it('orders by updatedAt, so an edited row is sent again', () => {
    expect(keysetWhereUpdated(CURSOR)).toEqual([
      {
        OR: [{ updatedAt: { gt: AT } }, { updatedAt: AT, id: { gt: 'row-5' } }],
      },
    ]);
  });
});
