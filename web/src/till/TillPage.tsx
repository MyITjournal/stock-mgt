import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';
import {
  addToCart,
  cartTotal,
  removeLine,
  toSaleLines,
  updateLine,
  type CartLine,
} from './cart';
import { ScanBox } from './ScanBox';
import { CartLines } from './CartLines';
import { PaymentPanel } from './PaymentPanel';
import { EMPTY_PAYMENT, needsBankAccount, type PaymentState } from './payment';
import { OverrideDialog, type OverrideKind } from './OverrideDialog';
import { Receipt } from './Receipt';

type ScanResult = components['schemas']['ScanResult'];
type ProductView = components['schemas']['ProductView'];
type ResolvedUnitPrice = components['schemas']['ResolvedUnitPrice'];
type SaleView = components['schemas']['SaleView'];
type SaleReceiptView = components['schemas']['SaleReceiptView'];
type CustomerView = components['schemas']['CustomerView'];
type BankAccountView = components['schemas']['BankAccountView'];
type PriceTierView = components['schemas']['PriceTierView'];

/**
 * The till.
 *
 * Three decisions shape this screen, and each is recorded where it is made:
 *
 * 1. **Scan first, search second.** One input handles both — a scanner is a
 *    keyboard — and a code that resolves goes straight into the cart. Only when
 *    `GET /scan/:code` says it knows nothing does the same text become a
 *    product search (DECISIONS.md §17).
 * 2. **The browser never works out a price.** Switching a piece to a carton, or
 *    naming a customer who buys on another tier, re-prices through
 *    `GET /products/:id/price`. The one arithmetic exception is the running
 *    total, which is exact because prices are tax-inclusive (§2).
 * 3. **A 409 is a rule, not an error.** Not enough stock, or a customer who
 *    still owes, both come back as refusals an owner or manager may override
 *    with a reason — and the reason is the override (§5, §6).
 */
export function TillPage() {
  const isManager = useIsManager();
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentState>(EMPTY_PAYMENT);
  const [searchResults, setSearchResults] = useState<ProductView[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<SaleReceiptView | null>(null);
  const [override, setOverride] = useState<{
    kind: OverrideKind;
    message: string;
  } | null>(null);

  /**
   * The id this sale will carry, minted once for the cart.
   *
   * **This is the stable thing, not the idempotency key.** The key is bound to
   * a hash of the request body, so an override retry — which adds a reason and
   * therefore changes the body — is correctly refused if it reuses one. What
   * makes two attempts the *same sale* is that they carry the same `id` and the
   * same line ids (§8); a fresh key rides along with each attempt.
   */
  const saleId = useRef<string>(crypto.randomUUID());

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccountView[]>('/bank-accounts'),
  });

  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });

  /**
   * Which price list this sale is on.
   *
   * The customer's own tier, falling back to the default — the same resolution
   * the server does when it prices a sale. Without it every lookup would come
   * back at `basePrice × factor`, which is right for a sachet and wrong for a
   * carton, and the till would quietly overcharge for cartons (§4).
   */
  const tierId = useMemo(() => {
    const customer = customers.find((row) => row.id === payment.customerId);
    return (
      customer?.priceTierId ?? tiers.find((tier) => tier.isDefault)?.id ?? null
    );
  }, [customers, payment.customerId, tiers]);

  const total = cartTotal(lines);

  /**
   * Fills in a line's other units in the background.
   *
   * A scan resolves one unit, which is all the fast path needs — the line is in
   * the cart before this returns. The picker is only useful once the rest of
   * the units are known, so it loads them without holding up the scan.
   */
  const loadUnits = useCallback(async (productId: string, key: string) => {
    try {
      const product = await api.get<ProductView>(`/products/${productId}`);
      setLines((current) =>
        updateLine(current, key, {
          units: product.units.map((unit) => ({
            id: unit.id,
            name: unit.name,
            factor: unit.factor,
          })),
        }),
      );
    } catch {
      // The line is already usable in the unit that was scanned. Failing to
      // widen the picker is not worth interrupting a sale over.
    }
  }, []);

  const addScanned = useCallback(
    (scan: ScanResult) => {
      const key = crypto.randomUUID();
      setLines((current) =>
        addToCart(current, {
          productId: scan.product.id,
          productName: scan.product.name,
          sku: scan.product.sku,
          unitId: scan.unit.id,
          unitName: scan.unit.name,
          units: [scan.unit],
          quantity: 1,
          unitPrice: scan.price,
          listPrice: scan.price,
          isTierPrice: scan.isTierPrice,
        }),
      );
      void loadUnits(scan.product.id, key);
    },
    [loadUnits],
  );

  const addProduct = useCallback(
    async (product: ProductView) => {
      setBusy(true);
      setError(null);
      try {
        const unit =
          product.units.find((row) => row.isDefaultSelling) ??
          product.units.find((row) => row.isBase) ??
          product.units[0];
        if (!unit) {
          setError(`${product.name} has no sellable unit.`);
          return;
        }

        const priced = await api.get<ResolvedUnitPrice>(
          `/products/${product.id}/price?unitId=${unit.id}` +
            (tierId ? `&tierId=${tierId}` : ''),
        );

        setLines((current) =>
          addToCart(current, {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            unitId: unit.id,
            unitName: unit.name,
            units: product.units.map((row) => ({
              id: row.id,
              name: row.name,
              factor: row.factor,
            })),
            quantity: 1,
            unitPrice: priced.price,
            listPrice: priced.price,
            isTierPrice: priced.isTierPrice,
          }),
        );
        setSearchResults(null);
      } catch (caught) {
        setError(messageFor(caught));
      } finally {
        setBusy(false);
      }
    },
    [tierId],
  );

  /** Scan, then search. The same box, the same Enter key. */
  const lookup = useCallback(
    async (term: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setSearchResults(null);

      try {
        const scan = await api.get<ScanResult>(
          `/scan/${encodeURIComponent(term)}` +
            (tierId ? `?tierId=${tierId}` : ''),
        );
        addScanned(scan);
        return;
      } catch (caught) {
        // Anything other than "no such code" is a real failure and should be
        // shown, not silently turned into a search.
        if (!(caught instanceof ApiError) || caught.status !== 404) {
          setError(messageFor(caught));
          setBusy(false);
          return;
        }
      }

      try {
        const found = await api.get<ProductView[]>(
          `/products?search=${encodeURIComponent(term)}`,
        );
        if (found.length === 0) {
          setNotice(`Nothing matches "${term}".`);
        } else if (found.length === 1) {
          await addProduct(found[0]);
        } else {
          setSearchResults(found);
        }
      } catch (caught) {
        setError(messageFor(caught));
      } finally {
        setBusy(false);
      }
    },
    [addProduct, addScanned, tierId],
  );

  /** Re-prices a line when its unit changes — on the server, never here. */
  const changeUnit = useCallback(
    async (key: string, unitId: string) => {
      const line = lines.find((row) => row.key === key);
      if (!line) return;
      const unit = line.units.find((row) => row.id === unitId);
      if (!unit) return;

      setBusy(true);
      try {
        const priced = await api.get<ResolvedUnitPrice>(
          `/products/${line.productId}/price?unitId=${unitId}` +
            (tierId ? `&tierId=${tierId}` : ''),
        );
        setLines((current) =>
          updateLine(current, key, {
            unitId,
            unitName: unit.name,
            unitPrice: priced.price,
            listPrice: priced.price,
            isTierPrice: priced.isTierPrice,
          }),
        );
      } catch (caught) {
        setError(messageFor(caught));
      } finally {
        setBusy(false);
      }
    },
    [lines, tierId],
  );

  const submit = useCallback(
    async (reasons?: { forcedReason?: string; creditOverrideReason?: string }) => {
      setBusy(true);
      setError(null);

      const paying = payment.amount ?? total;

      try {
        const sale = await api.post<SaleView>(
          '/sales',
          {
            id: saleId.current,
            ...(payment.customerId && { customerId: payment.customerId }),
            lines: toSaleLines(lines),
            payment: {
              amount: paying,
              method: payment.method,
              ...(payment.reference.trim() && {
                reference: payment.reference.trim(),
              }),
              ...(payment.bankAccountId && {
                bankAccountId: payment.bankAccountId,
              }),
            },
            ...(reasons?.forcedReason && {
              force: true,
              forcedReason: reasons.forcedReason,
            }),
            ...(reasons?.creditOverrideReason && {
              creditOverrideReason: reasons.creditOverrideReason,
            }),
          },
          // One key per attempt. `api.post` reuses it across its own internal
          // retry behind a refreshed session, which is the case that matters;
          // a second *deliberate* attempt is a different body and needs its own.
          crypto.randomUUID(),
        );

        // The receipt is read back rather than assembled from the cart, so what
        // the customer is handed is the server's arithmetic (§17).
        const receipt = await api.get<SaleReceiptView>(
          `/sales/${sale.id}/receipt`,
        );
        setCompleted(receipt);
        setOverride(null);

        // A counter sale is the widest write in the application: it moves
        // stock, banks a payment, and creates both an invoice and — on credit
        // — a receivable. This used to refresh nothing at all, so selling the
        // last carton left the stock screen still showing it on the shelf.
        afterWrite(queryClient);
      } catch (caught) {
        if (caught instanceof ApiError && caught.isConflict && isManager) {
          setOverride({
            kind: kindOfConflict(caught.message),
            message: caught.message,
          });
        } else {
          setError(messageFor(caught));
          setOverride(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [isManager, lines, payment, total, queryClient],
  );

  const startNewSale = useCallback(() => {
    setLines([]);
    setPayment(EMPTY_PAYMENT);
    setCompleted(null);
    setSearchResults(null);
    setError(null);
    setNotice(null);
    saleId.current = crypto.randomUUID();
  }, []);

  if (completed) {
    return (
      <Page title="Sale recorded">
        <Receipt receipt={completed} onNewSale={startNewSale} />
      </Page>
    );
  }

  const paying = payment.amount ?? total;
  const canSubmit =
    lines.length > 0 &&
    (!needsBankAccount(payment.method) || Boolean(payment.bankAccountId)) &&
    (paying >= total || Boolean(payment.customerId));

  return (
    <Page
      title="Till"
      description="Scan or search, then take the payment."
      actions={
        lines.length > 0 ? (
          <Button variant="secondary" onClick={startNewSale} disabled={busy}>
            Clear
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <ScanBox onSubmit={lookup} busy={busy} disabled={Boolean(override)} />

          {error && (
            <p
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">
              {notice}
            </p>
          )}

          {searchResults && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
                {searchResults.length} matches — pick one
              </div>
              <ul className="divide-y divide-slate-100">
                {searchResults.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => void addProduct(product)}
                      disabled={busy}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
                    >
                      <span>
                        <span className="font-medium text-slate-900">
                          {product.name}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">
                          {product.sku}
                        </span>
                      </span>
                      <Money value={product.basePrice} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <CartLines
            lines={lines}
            busy={busy}
            onQuantityChange={(key, quantity) =>
              setLines((current) => updateLine(current, key, { quantity }))
            }
            onUnitChange={(key, unitId) => void changeUnit(key, unitId)}
            onPriceChange={(key, price) =>
              price !== null &&
              setLines((current) =>
                updateLine(current, key, { unitPrice: price }),
              )
            }
            onResetPrice={(key) =>
              setLines((current) => {
                const line = current.find((row) => row.key === key);
                return line
                  ? updateLine(current, key, { unitPrice: line.listPrice })
                  : current;
              })
            }
            onRemove={(key) => setLines((current) => removeLine(current, key))}
          />
        </div>

        <PaymentPanel
          state={payment}
          onChange={setPayment}
          total={total}
          customers={customers}
          accounts={accounts}
          busy={busy}
          canSubmit={canSubmit}
          onSubmit={() => void submit()}
        />
      </div>

      {override && (
        <OverrideDialog
          kind={override.kind}
          serverMessage={override.message}
          busy={busy}
          onCancel={() => setOverride(null)}
          onConfirm={(reason) =>
            void submit(
              override.kind === 'stock'
                ? { forcedReason: reason }
                : { creditOverrideReason: reason },
            )
          }
        />
      )}
    </Page>
  );
}

/**
 * Which refusal this is.
 *
 * Both arrive as a 409 with a message written for a person, and the server does
 * not tag them — so the message is what distinguishes them. Credit is matched
 * on its own wording and everything else is treated as a stock shortfall, which
 * is the commoner case and the one whose override the server will refuse
 * outright if this guesses wrong. A wrong guess therefore costs a clear refusal
 * rather than a wrongly-recorded sale.
 */
function kindOfConflict(message: string): OverrideKind {
  return /owe|credit|balance|outstanding/i.test(message) ? 'credit' : 'stock';
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}
