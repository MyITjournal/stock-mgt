import type { QueryClient } from '@tanstack/react-query';

/**
 * Marks every cached read stale, after any write.
 *
 * ## Why this is blunt on purpose
 *
 * Each mutation used to list the caches it thought it had affected, and
 * **nearly every one of them listed the wrong set** — not through
 * carelessness, but because the list is a claim about the *server's* write,
 * and the person editing a screen is thinking about that screen:
 *
 * - Recording a sale at the till invalidated **nothing at all**, so stock
 *   still read its old quantity after selling from it.
 * - Recording a payment refreshed receivables, payments and sales, but not
 *   the customer's own page or statement — the two screens actually showing
 *   that customer's balance.
 * - A restocked return refreshed the sale and receivables but not stock,
 *   though putting goods back on a shelf is the whole point of restocking.
 * - A delivery raises a supplier bill, so it touches payables and purchase
 *   targets as well as stock. Nobody listed the targets.
 *
 * The lists cannot be kept right by inspection: a write reaches whatever the
 * server says it reaches, which is a fact about the API, not about the screen
 * that called it. So no screen states it any more.
 *
 * ## What it costs
 *
 * Invalidation defaults to refetching **active** queries only, so this
 * refetches what is currently on screen and merely marks the rest stale. A
 * screen holds a handful of queries, so a write costs two or three small
 * requests — all of them for data the person is about to look at, since they
 * just changed it.
 *
 * That is worth more than the requests it saves. The failure it replaces is
 * silent and reads as a broken write: somebody records a payment, the balance
 * does not move, and they record it again.
 *
 * The one thing worth keeping alongside this is an **immediate** optimistic
 * write — `setQueryData` for the row that was just returned — so the screen
 * repaints before the refetch lands. That is a separate concern and still
 * correct.
 */
export function afterWrite(queryClient: QueryClient): void {
  void queryClient.invalidateQueries();
}
