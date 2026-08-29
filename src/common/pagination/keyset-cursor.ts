import { BadRequestException } from '@nestjs/common';

/**
 * Keyset paging over `(createdAt, id)`, shared by everything the mobile app
 * pulls down: the stock ledger, and sales.
 *
 * Offsets are wrong for a syncing client — rows inserted while it pages shift
 * everything after them — so the cursor names the last row seen instead.
 */
export interface KeysetCursor {
  createdAt: Date;
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
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string): KeysetCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const createdAt = new Date(decoded.slice(0, separator));

  if (separator === -1 || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException(
      'Malformed sync cursor. Pass back the nextCursor from the previous page, or omit it to start over.',
    );
  }

  return { createdAt, id: decoded.slice(separator + 1) };
}

/**
 * The `AND` clause that walks forward from a cursor, or from `since` when the
 * client is starting a fresh pull. A cursor always wins: it is more precise
 * than a timestamp, and mixing the two would re-send rows.
 */
export function keysetWhere(cursor?: KeysetCursor, since?: Date) {
  if (cursor) {
    return [
      {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      },
    ];
  }
  return since ? [{ createdAt: { gt: since } }] : [];
}
