import { BadRequestException } from '@nestjs/common';

/**
 * Keyset paging for everything the mobile app pulls down: the stock ledger,
 * sales, payments and expenses.
 *
 * Offsets are wrong for a syncing client — rows inserted while it pages shift
 * everything after them — so the cursor names the last row seen instead.
 *
 * ## Append-only rows page by `createdAt`; mutable rows page by `updatedAt`
 *
 * This is the rule, and getting it wrong is silent. A feed ordered by
 * `createdAt` only ever tells a client about rows it has never seen. That is
 * exactly right for the stock ledger, which is append-only: a movement is
 * written once and never changes, so a client that has seen it needs nothing
 * further.
 *
 * It is wrong the moment a row can change after it is written. Voiding a
 * payment moves `updatedAt` and leaves `createdAt` alone, so a client that has
 * already paged past that payment never hears about the void and goes on
 * showing an invoice as settled — money the business does not have, on a screen
 * nobody thinks to doubt.
 *
 * Ordering by `updatedAt` fixes it because a row only ever moves **forward** in
 * the ordering. Moving forward can re-send a row the client already has, which
 * is why clients must upsert by id; it cannot skip one, which is the failure
 * that matters.
 *
 * Derived figures are a client-side concern: a sale's balance changes when a
 * payment against it is voided, without the `Sale` row itself being touched.
 * Clients compute balance from the payments and returns they have synced, using
 * the same `balance.ts` arithmetic the server uses — which is why the payment
 * feed being correct is what makes the sale's balance correct.
 */
export interface KeysetCursor {
  /**
   * The timestamp the feed is ordered by — `createdAt` or `updatedAt`
   * depending on the feed. Named neutrally because the cursor does not care
   * which, and the wire format is the same either way.
   */
  at: Date;
  id: string;
}

/**
 * How far behind the server clock a page is allowed to reach.
 *
 * A row committed at 12:00:00.400 can become visible *after* one committed at
 * 12:00:00.600 — the timestamp is taken when the statement runs, the row
 * appears when the transaction commits. A cursor that advances to the newest
 * visible row therefore steps over anything still in flight, and because the
 * cursor only ever moves forward, that row is missed forever.
 *
 * Holding the window a second short of now means an in-flight transaction has
 * committed by the time its slice of time becomes eligible.
 */
export const SYNC_LAG_MS = 1000;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string): KeysetCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const at = new Date(decoded.slice(0, separator));

  if (separator === -1 || Number.isNaN(at.getTime())) {
    throw new BadRequestException(
      'Malformed sync cursor. Pass back the nextCursor from the previous page, or omit it to start over.',
    );
  }

  return { at, id: decoded.slice(separator + 1) };
}

/**
 * Walks forward from a cursor over an **append-only** feed, or from `since`
 * when the client is starting a fresh pull.
 *
 * A cursor always wins: it is more precise than a timestamp, and mixing the two
 * would re-send rows.
 */
export function keysetWhereCreated(cursor?: KeysetCursor, since?: Date) {
  if (cursor) {
    return [
      {
        OR: [
          { createdAt: { gt: cursor.at } },
          { createdAt: cursor.at, id: { gt: cursor.id } },
        ],
      },
    ];
  }
  return since ? [{ createdAt: { gt: since } }] : [];
}

/**
 * The same walk over a **mutable** feed, ordered by `updatedAt` so that a row
 * edited after the client last synced is sent again.
 *
 * Use this for any table whose rows can change after they are written —
 * payments, which can be voided, and expenses, which can be edited or deleted.
 */
export function keysetWhereUpdated(cursor?: KeysetCursor, since?: Date) {
  if (cursor) {
    return [
      {
        OR: [
          { updatedAt: { gt: cursor.at } },
          { updatedAt: cursor.at, id: { gt: cursor.id } },
        ],
      },
    ];
  }
  return since ? [{ updatedAt: { gt: since } }] : [];
}
