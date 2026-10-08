import type { components } from '../api/schema';

type AuditMovement =
  components['schemas']['StockAuditView']['movements'][number];

/** One line of "Decisions somebody made": a movement, or several added up. */
export type AuditLine = AuditMovement & {
  /** How many movements this line adds up. 1 for one left as it was. */
  entries: number;
};

/**
 * One line per item (2026-10-07, owner: "add up the quantities to show only
 * one line per item"). An opening stock entered as cartons plus loose pieces,
 * or a count corrected twice, wrote a movement each, and the list read like a
 * stammer.
 *
 * Movements are added up when they share the **product and option, the place,
 * the reason and the person** — the same decision made in pieces. The line carries the
 * latest time and how many it holds. **A forced movement stays on its own**:
 * each was pushed through a shortfall with its own reason, and adding those
 * together would hide the reasons. Quantities are counts, not money, so the
 * sum is the screen's to do.
 *
 * Order is kept: a line sits where its newest movement was.
 */
export function auditLines(movements: readonly AuditMovement[]): AuditLine[] {
  const lines: AuditLine[] = [];
  const byKey = new Map<string, AuditLine>();

  for (const movement of movements) {
    if (movement.isForced) {
      lines.push({ ...movement, entries: 1 });
      continue;
    }
    const key = [
      movement.product.id,
      // Gold and Classic are two items (§24), never one line.
      movement.variant?.id ?? '',
      movement.location.id,
      movement.reason ?? movement.type,
      movement.recordedBy?.id ?? 'nobody',
    ].join('|');
    const line = byKey.get(key);
    if (!line) {
      const fresh = { ...movement, entries: 1 };
      byKey.set(key, fresh);
      lines.push(fresh);
      continue;
    }
    line.quantity += movement.quantity;
    line.entries += 1;
    if (new Date(movement.createdAt) > new Date(line.createdAt)) {
      line.createdAt = movement.createdAt;
    }
  }

  return lines;
}
