import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useAuth, useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';
import {
  addToCart,
  applyRepricing,
  cartTotal,
  removeLine,
  toSaleLines,
  updateLine,
  type CartLine,
  type UnitOption,
  type Repriced,
} from './cart';
import { ScanBox } from './ScanBox';
import { CameraScanner } from '../components/CameraScanner';
import { CartLines } from './CartLines';
import { PaymentPanel } from './PaymentPanel';
import {
  EMPTY_PAYMENT,
  needsBankAccount,
  payingNow,
  type PaymentState,
} from './payment';
import { OverrideDialog, type OverrideKind } from './OverrideDialog';
import { DuplicateDialog, type PossibleDuplicate } from './DuplicateDialog';
import { Receipt } from './Receipt';
import { CustomerDialog } from '../customers/CustomerDialog';
import { DuePayments } from '../components/DuePayments';
import { SaleDateBar } from './SaleDateBar';
import { occurredAtFor, today } from '../lib/paidOn';
import { keptAt, useKeepDraft, useRestoredDraft } from '../lib/draft';
import { optionLabel, optionQuery } from '../lib/options';
import { OptionPicker } from './OptionPicker';

type ScanResult = components['schemas']['ScanResult'];
type ScannedOption = ScanResult['options'][number];
type ProductView = components['schemas']['ProductView'];
type ResolvedUnitPrice = components['schemas']['ResolvedUnitPrice'];
type SaleView = components['schemas']['SaleView'];
type SaleReceiptView = components['schemas']['SaleReceiptView'];
type CustomerView = components['schemas']['CustomerView'];
type BankAccountView = components['schemas']['BankAccountView'];
type PriceTierView = components['schemas']['PriceTierView'];
type TillSearchResult = components['schemas']['TillSearchResult'];

/** How long typing pauses before suggestions are asked for. */
const SUGGEST_AFTER_MS = 250;

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
 *    `GET /products/:id/price` — the whole cart, not only the next line
 *    (`repriceCart`; until 2026-10-04 this sentence was true of new lines
 *    only). The one arithmetic exception is the running total, which is exact
 *    because prices are tax-inclusive (§2).
 * 3. **A 409 is a rule, not an error.** Not enough stock, or a customer who
 *    still owes, both come back as refusals an owner or manager may override
 *    with a reason — and the reason is the override (§5, §6).
 */
/** What the till keeps in the browser until the sale is saved. */
interface TillDraft {
  saleId: string;
  lines: CartLine[];
  payment: PaymentState;
  saleDay: string;
}

export function TillPage() {
  const isManager = useIsManager();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // A sale being rung up is kept in this browser until the server accepts it,
  // so a failed save or a refresh brings it back instead of losing it.
  const draftKey = user ? `till.${user.organizationId}` : null;
  const draft = useRestoredDraft<TillDraft>(draftKey);
  const kept = draft.restored?.value;

  const [lines, setLines] = useState<CartLine[]>(kept?.lines ?? []);
  const [payment, setPayment] = useState<PaymentState>(
    kept?.payment ?? EMPTY_PAYMENT,
  );
  // The day these sales were made — today unless an owner or manager is
  // typing in an earlier day's sales. Not cleared between sales, so a day's
  // notebook goes in as a run; `SaleDateBar` says so while it is not today.
  const [saleDay, setSaleDay] = useState(kept?.saleDay ?? today);
  // Bumped to hand the cursor back to the item search.
  const [focusKey, setFocusKey] = useState(0);
  const backToSearch = useCallback(() => setFocusKey((n) => n + 1), []);
  // What is in the search box, and the same text once typing has paused —
  // suggestions follow the second, so a request is not sent per keystroke.
  const [term, setTerm] = useState('');
  const [settledTerm, setSettledTerm] = useState('');
  // The highlighted suggestion, for the arrow keys. -1 is none, and Enter then
  // means "this is a barcode" rather than "this one".
  const [activeIndex, setActiveIndex] = useState(-1);
  // The phone camera, open for a run of scans until the cashier taps Done,
  // and the product it read last — its line is shown under the picture so the
  // unit and quantity can be set without scrolling a fifty-line cart.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScanned, setLastScanned] = useState<{
    productId: string;
    variantId: string | null;
  } | null>(null);
  // A code on every option of a product — the till asks which one.
  const [choosing, setChoosing] = useState<ScanResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True while the cart is being moved onto another price list. Payment waits
  // for it: taking money mid-way would record the old prices.
  const [repricing, setRepricing] = useState(false);
  // Which re-pricing is current. A customer changed twice in quick succession
  // starts two; only the answer for the latest choice may land.
  const repriceRun = useRef(0);
  const [completed, setCompleted] = useState<{
    receipt: SaleReceiptView;
    saleId: string;
  } | null>(null);
  const [override, setOverride] = useState<{
    kind: OverrideKind;
    message: string;
  } | null>(null);
  // "Already recorded?" (2026-10-08): the sale it looks like, while asked.
  const [duplicate, setDuplicate] = useState<PossibleDuplicate | null>(null);
  // Once somebody chose Record anyway, every later attempt at this same sale
  // — an override retry after a stock or credit refusal — says so too, or the
  // warning would come back between them.
  const [recordAnyway, setRecordAnyway] = useState(false);

  /**
   * The id this sale will carry, minted once for the cart.
   *
   * **This is the stable thing, not the idempotency key.** The key is bound to
   * a hash of the request body, so an override retry — which adds a reason and
   * therefore changes the body — is correctly refused if it reuses one. What
   * makes two attempts the *same sale* is that they carry the same `id` and the
   * same line ids (§8); a fresh key rides along with each attempt.
   */
  // Restored with the draft: the same sale, so a retry after a lost reply can
  // never record it twice.
  const [saleId, setSaleId] = useState<string>(
    () => kept?.saleId ?? crypto.randomUUID(),
  );
  const [addingCustomer, setAddingCustomer] = useState(false);

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
  const tierFor = useCallback(
    (customerId: string | null) => {
      const customer = customers.find((row) => row.id === customerId);
      return (
        customer?.priceTierId ??
        tiers.find((tier) => tier.isDefault)?.id ??
        null
      );
    },
    [customers, tiers],
  );
  const tierId = useMemo(
    () => tierFor(payment.customerId),
    [tierFor, payment.customerId],
  );

  // Suggestions follow the text once typing pauses.
  useEffect(() => {
    const timer = setTimeout(
      () => setSettledTerm(term.trim()),
      SUGGEST_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [term]);

  const showSuggestions = term.trim().length >= 2 && settledTerm.length >= 2;
  const { data: suggestionData, isFetching: searching } = useQuery({
    queryKey: ['till-search', settledTerm, tierId],
    queryFn: () => tillSearch(settledTerm, tierId),
    enabled: settledTerm.length >= 2,
    staleTime: 30_000,
  });
  const suggestions = useMemo(
    () => (showSuggestions ? (suggestionData ?? []) : []),
    [showSuggestions, suggestionData],
  );

  /**
   * Moves every line already in the cart onto another price list.
   *
   * Naming a customer who buys on another tier changes the price of goods
   * already scanned, not only of the next ones — a cashier who rings up a
   * trade customer's order and then picks them from the list must not charge
   * retail. This used to be promised in the docstring above and not done.
   *
   * Priced on the server, one request per line, like every other price (§4);
   * the cart's rules for what moves and what stays are `applyRepricing`.
   */
  const repriceCart = useCallback(
    async (nextTierId: string | null, cart: readonly CartLine[]) => {
      if (cart.length === 0) return;
      const run = ++repriceRun.current;
      setRepricing(true);
      setError(null);
      try {
        const priced: Repriced[] = await Promise.all(
          cart.map(async (line) => {
            const result = await api.get<ResolvedUnitPrice>(
              `/products/${line.productId}/price?unitId=${line.unitId}` +
                (nextTierId ? `&tierId=${nextTierId}` : '') +
                optionQuery(line.variantId),
            );
            return {
              key: line.key,
              unitId: line.unitId,
              price: result.price,
              isTierPrice: result.isTierPrice,
            };
          }),
        );
        if (run !== repriceRun.current) return;

        setLines((current) => applyRepricing(current, priced).lines);
        // Worked out from the answers, not from inside the updater above:
        // React may run that later, and a list read from it here could be
        // empty — the warning would silently never show.
        const unpriced = cart.filter((line) =>
          priced.some((row) => row.key === line.key && row.price === null),
        );
        const tierName =
          tiers.find((tier) => tier.id === nextTierId)?.name ?? 'this';
        if (unpriced.length > 0) {
          setError(
            `${unpriced.map((line) => `${optionLabel(line.productName, line.variantName)} (${line.unitName})`).join(', ')} ${unpriced.length === 1 ? 'has' : 'have'} no price on the ${tierName} list, so ${unpriced.length === 1 ? 'it keeps its' : 'they keep their'} previous price. Check before taking payment.`,
          );
        } else {
          setNotice(`Prices moved to the ${tierName} list.`);
        }
      } catch (caught) {
        if (run === repriceRun.current) {
          setError(
            `Could not update the prices for this customer — ${messageFor(caught)} Pick the customer again to retry.`,
          );
        }
      } finally {
        if (run === repriceRun.current) setRepricing(false);
      }
    },
    [tiers],
  );

  /** The payment panel's changes, re-pricing the cart when the tier moves. */
  const changePayment = useCallback(
    (next: PaymentState) => {
      setPayment(next);
      if (next.customerId === payment.customerId) return;
      const nextTierId = tierFor(next.customerId);
      if (nextTierId !== tierId) void repriceCart(nextTierId, lines);
    },
    [payment.customerId, tierFor, tierId, repriceCart, lines],
  );

  /**
   * A customer just added from the till becomes this sale's customer.
   *
   * Added here, they are a name and a phone number with no price list of
   * their own — pricing lives on the unit (a carton, a 1/5 carton), not on
   * who is buying — so the cart stays on the prices it already has. The row
   * goes into the cached list at once, so the picker shows their name rather
   * than "Walk-in" while the list refetches.
   */
  const takeNewCustomer = useCallback(
    (created: CustomerView) => {
      queryClient.setQueryData<CustomerView[]>(['customers'], (current = []) =>
        current.some((row) => row.id === created.id)
          ? current
          : [...current, created],
      );
      changePayment({ ...payment, customerId: created.id });
    },
    [queryClient, changePayment, payment],
  );

  const total = cartTotal(lines);

  /**
   * Fills in a line's other units in the background.
   *
   * A scan resolves one unit, which is all the fast path needs — the line is in
   * the cart before this returns. The picker is only useful once the rest of
   * the units are known, so it loads them without holding up the scan.
   *
   * Matched by product, not by line key. It used to be handed a key minted
   * here, but `addToCart` mints its own, so the lookup found nothing and the
   * picker after a scan never widened past the scanned unit. Every line of
   * the product gets the same list, which is also true.
   */
  const loadUnits = useCallback(async (productId: string) => {
    try {
      const product = await api.get<ProductView>(`/products/${productId}`);
      const units = sellableUnits(product);
      setLines((current) =>
        current.map((line) =>
          line.productId === productId ? { ...line, units } : line,
        ),
      );
    } catch {
      // The line is already usable in the unit that was scanned. Failing to
      // widen the picker is not worth interrupting a sale over.
    }
  }, []);

  const addScanned = useCallback(
    (scan: ScanResult, picked?: ScannedOption): boolean => {
      // A code on a unit only counted in — the single sachet a distributor
      // never sells. The server would refuse the sale; saying so now is kinder
      // than letting it reach the checkout.
      if (!scan.unit.isSellable) {
        setError(
          `${scan.product.name} is not sold by the ${scan.unit.name}. Scan the pack or carton instead, or pick it from the search.`,
        );
        return false;
      }
      // A code on the product as a whole, for a product with options: which
      // one is being sold is a question for the person at the till.
      if (!picked && !scan.variant && scan.options.length > 0) {
        setChoosing(scan);
        return false;
      }
      // Priced as the option already — its own price, else the product's.
      const option = picked ?? scan.variant;
      const price = option ? option.price : scan.price;
      if (price === null) {
        setError(
          unpricedMessage(
            optionLabel(scan.product.name, option?.name),
            scan.unit.name,
          ),
        );
        return false;
      }
      setLines((current) =>
        addToCart(current, {
          productId: scan.product.id,
          variantId: option?.id ?? null,
          variantName: option?.name ?? null,
          productName: scan.product.name,
          size: scan.product.size,
          sku: scan.product.sku,
          unitId: scan.unit.id,
          unitName: scan.unit.name,
          units: [scan.unit],
          quantity: 1,
          unitPrice: price,
          listPrice: price,
          isTierPrice: scan.isTierPrice,
        }),
      );
      void loadUnits(scan.product.id);
      backToSearch();
      return true;
    },
    [loadUnits, backToSearch],
  );

  /**
   * One code from the camera. Not `lookup`: a camera reads only barcodes, so
   * there is nothing to fall back to a name search with, and the camera stays
   * open whatever happens — an unknown code is a message, not a stop.
   */
  const scanFromCamera = useCallback(
    async (code: string) => {
      setError(null);
      setNotice(null);
      try {
        const scan = await api.get<ScanResult>(
          `/scan/${encodeURIComponent(code)}` +
            (tierId ? `?tierId=${tierId}` : ''),
        );
        if (addScanned(scan)) {
          setLastScanned({
            productId: scan.product.id,
            variantId: scan.variant?.id ?? null,
          });
          setNotice(
            `Added ${optionLabel(scan.product.name, scan.variant?.name)}.`,
          );
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) {
          setNotice(
            `Code ${code} is not on any product yet. Add it to the product, then scan again.`,
          );
        } else {
          setError(messageFor(caught));
        }
      }
    },
    [addScanned, tierId],
  );

  /** Empties the search box and puts the suggestions away. */
  const clearSearch = useCallback(() => {
    setTerm('');
    setSettledTerm('');
    setActiveIndex(-1);
  }, []);

  /**
   * Adds a suggestion to the cart — with no request, because the till search
   * already priced every sellable unit on the cart's tier. That is the point
   * of it: picking used to wait on a scan attempt, a search and a price lookup
   * in turn, about ten seconds on the hosted instance.
   */
  const addFromSearch = useCallback(
    (product: TillSearchResult) => {
      setError(null);
      setNotice(null);
      const unit = product.units.find(
        (row) => row.id === product.defaultUnitId,
      );
      if (!unit) return;
      if (unit.price === null) {
        setError(
          unpricedMessage(
            optionLabel(product.name, product.variant?.name),
            unit.name,
          ),
        );
        return;
      }
      const price = unit.price;
      setLines((current) =>
        addToCart(current, {
          productId: product.id,
          variantId: product.variant?.id ?? null,
          variantName: product.variant?.name ?? null,
          productName: product.name,
          size: product.size,
          sku: product.sku,
          unitId: unit.id,
          unitName: unit.name,
          units: product.units.map((row) => ({
            id: row.id,
            name: row.name,
            factor: row.factor,
          })),
          quantity: 1,
          unitPrice: price,
          listPrice: price,
          isTierPrice: unit.isTierPrice,
        }),
      );
      clearSearch();
      backToSearch();
    },
    [clearSearch, backToSearch],
  );

  /**
   * Enter. A highlighted suggestion is picked; otherwise the text is tried as a
   * barcode — a scanner types faster than suggestions arrive, and presses
   * Enter — and only then searched.
   */
  const lookup = useCallback(
    async (text: string) => {
      const highlighted = activeIndex >= 0 ? suggestions[activeIndex] : null;
      if (highlighted) {
        addFromSearch(highlighted);
        return;
      }

      setBusy(true);
      setError(null);
      setNotice(null);

      try {
        const scan = await api.get<ScanResult>(
          `/scan/${encodeURIComponent(text)}` +
            (tierId ? `?tierId=${tierId}` : ''),
        );
        addScanned(scan);
        clearSearch();
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
        // Usually already answered while the text was typed, so this costs
        // nothing; a pasted or very fast entry asks now.
        const found = await queryClient.fetchQuery({
          queryKey: ['till-search', text, tierId],
          queryFn: () => tillSearch(text, tierId),
        });
        if (found.length === 0) {
          setNotice(`Nothing matches "${text}".`);
        } else if (found.length === 1) {
          addFromSearch(found[0]);
        } else {
          // Several: leave the text in the box and show them to pick from.
          setSettledTerm(text);
        }
      } catch (caught) {
        setError(messageFor(caught));
      } finally {
        setBusy(false);
      }
    },
    [
      activeIndex,
      suggestions,
      addFromSearch,
      addScanned,
      clearSearch,
      queryClient,
      tierId,
    ],
  );

  const navigate = useCallback(
    (key: 'ArrowDown' | 'ArrowUp' | 'Escape') => {
      if (key === 'Escape') {
        clearSearch();
        return;
      }
      if (suggestions.length === 0) return;
      setActiveIndex((current) =>
        key === 'ArrowDown'
          ? Math.min(current + 1, suggestions.length - 1)
          : Math.max(current - 1, -1),
      );
    },
    [suggestions.length, clearSearch],
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
            (tierId ? `&tierId=${tierId}` : '') +
            optionQuery(line.variantId),
        );
        const price = priced.price;
        if (price === null) {
          // The line stays in the unit it was in, at the price it had —
          // switching it to a unit with no price would leave nothing to charge.
          setError(
            unpricedMessage(
              optionLabel(line.productName, line.variantName),
              unit.name,
            ),
          );
          return;
        }
        setLines((current) =>
          updateLine(current, key, {
            unitId,
            unitName: unit.name,
            unitPrice: price,
            listPrice: price,
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
    async (reasons?: {
      forcedReason?: string;
      creditOverrideReason?: string;
      allowDuplicate?: boolean;
    }) => {
      setBusy(true);
      setError(null);

      const paying = payingNow(payment, total);

      try {
        const sale = await api.post<SaleView>(
          '/sales',
          {
            id: saleId,
            // Today sends nothing, so the server's clock dates it as before.
            ...(isManager && occurredAtFor(saleDay)),
            ...(payment.customerId && { customerId: payment.customerId }),
            lines: toSaleLines(lines),
            // Paying later is a sale with nothing paid: no money moved, so
            // no account or reference rides along — the server writes no
            // payment row for an amount of 0 and the invoice is owed.
            payment: payment.payLater
              ? { amount: 0, method: 'cash' }
              : {
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
            ...((reasons?.allowDuplicate || recordAnyway) && {
              allowDuplicate: true,
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
        setCompleted({ receipt, saleId: sale.id });
        setOverride(null);
        setDuplicate(null);

        // A counter sale is the widest write in the application: it moves
        // stock, banks a payment, and creates both an invoice and — on credit
        // — a receivable. This used to refresh nothing at all, so selling the
        // last carton left the stock screen still showing it on the shelf.
        afterWrite(queryClient);
      } catch (caught) {
        // Looks already recorded: a warning for whoever is at the till, so
        // it is checked before the owner-only refusals below.
        if (
          caught instanceof ApiError &&
          caught.code === 'POSSIBLE_DUPLICATE'
        ) {
          setDuplicate(caught.body as PossibleDuplicate);
          setOverride(null);
        } else if (
          caught instanceof ApiError &&
          caught.isConflict &&
          isManager
        ) {
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
    [
      isManager,
      lines,
      payment,
      saleDay,
      saleId,
      total,
      queryClient,
      recordAnyway,
    ],
  );

  // The last line for the product the camera read — after a unit change the
  // line's key is the same but its unit is not, so it is found by product, and
  // by option: Gold scanned is the Gold line, not the Classic one above it.
  const justScanned = lastScanned
    ? lines.findLast(
        (line) =>
          line.productId === lastScanned.productId &&
          (line.variantId ?? null) === lastScanned.variantId,
      )
    : undefined;

  const lineHandlers = {
    onQuantityChange: (key: string, quantity: number) =>
      setLines((current) => updateLine(current, key, { quantity })),
    onUnitChange: (key: string, unitId: string) => void changeUnit(key, unitId),
    onPriceChange: (key: string, price: number | null) => {
      if (price !== null) {
        setLines((current) => updateLine(current, key, { unitPrice: price }));
      }
    },
    onResetPrice: (key: string) =>
      setLines((current) => {
        const line = current.find((row) => row.key === key);
        return line
          ? updateLine(current, key, { unitPrice: line.listPrice })
          : current;
      }),
    onRemove: (key: string) => setLines((current) => removeLine(current, key)),
    onDone: backToSearch,
  };

  // Kept while there is something to lose; cleared once the sale is saved
  // (`completed`) or the cart is emptied.
  useKeepDraft<TillDraft>(
    draftKey,
    { saleId, lines, payment, saleDay },
    lines.length > 0 && !completed,
  );

  const startNewSale = useCallback(() => {
    setLines([]);
    setPayment(EMPTY_PAYMENT);
    setCompleted(null);
    setTerm('');
    setSettledTerm('');
    setActiveIndex(-1);
    setCameraOpen(false);
    setLastScanned(null);
    setChoosing(null);
    setError(null);
    setNotice(null);
    setSaleId(crypto.randomUUID());
    setDuplicate(null);
    setRecordAnyway(false);
    // A re-pricing still in flight belongs to the sale just abandoned; this
    // makes its answer stale so it cannot speak up on the new one.
    repriceRun.current += 1;
    setRepricing(false);
  }, []);

  if (completed) {
    return (
      <Page title="Sale recorded">
        <Receipt
          receipt={completed.receipt}
          saleId={completed.saleId}
          onNewSale={startNewSale}
        />
      </Page>
    );
  }

  const paying = payingNow(payment, total);
  const canSubmit =
    lines.length > 0 &&
    (payment.payLater ||
      !needsBankAccount(payment.method) ||
      Boolean(payment.bankAccountId)) &&
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
      <DuePayments collapsible />
      {draft.noticeOpen && draft.restored && lines.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>
            The sale you were ringing up at {keptAt(draft.restored.savedAt)} was
            not saved, so it has been brought back. Check it and take the
            payment again.
          </span>
          <Button variant="secondary" onClick={draft.dismiss}>
            OK
          </Button>
        </div>
      )}
      {isManager && (
        <SaleDateBar day={saleDay} onChange={setSaleDay} disabled={busy} />
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {cameraOpen ? (
            // Stays at the top while the cart grows beneath it.
            <div className="sticky top-0 z-20">
              <CameraScanner
                continuous
                onCode={(code) => void scanFromCamera(code)}
                onClose={() => {
                  setCameraOpen(false);
                  setLastScanned(null);
                }}
              >
                {justScanned && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Just scanned — set the unit and quantity
                    </p>
                    <CartLines
                      lines={[justScanned]}
                      busy={busy}
                      {...lineHandlers}
                    />
                  </div>
                )}
              </CameraScanner>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null);
                setCameraOpen(true);
              }}
              className="w-full sm:w-auto"
            >
              Scan with camera
            </Button>
          )}

          <ScanBox
            value={term}
            onChange={(next) => {
              setTerm(next);
              setActiveIndex(-1);
            }}
            onSubmit={(text) => void lookup(text)}
            onNavigate={navigate}
            busy={busy}
            disabled={Boolean(override) || cameraOpen}
            focusKey={focusKey}
            listId={suggestions.length > 0 ? 'till-suggestions' : undefined}
            activeId={
              activeIndex >= 0 ? `till-suggestion-${activeIndex}` : undefined
            }
          />

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

          {showSuggestions && searching && suggestions.length === 0 && (
            <p className="text-sm text-slate-500">Searching…</p>
          )}
          {showSuggestions && !searching && suggestionData?.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing matches "{settledTerm}" yet. Press Enter to try it as a
              barcode.
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <ul
                id="till-suggestions"
                role="listbox"
                className="divide-y divide-slate-100"
              >
                {suggestions.map((product, index) => {
                  const unit = product.units.find(
                    (row) => row.id === product.defaultUnitId,
                  );
                  return (
                    <li
                      key={`${product.id}:${product.variant?.id ?? ''}`}
                      id={`till-suggestion-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button
                        type="button"
                        onClick={() => addFromSearch(product)}
                        disabled={busy}
                        className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm disabled:opacity-60 ${
                          index === activeIndex
                            ? 'bg-brand-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span>
                          <span className="font-medium text-slate-900">
                            {optionLabel(product.name, product.variant?.name)}
                          </span>
                          {product.size && (
                            <span className="ml-2 text-slate-600">
                              {product.size}
                            </span>
                          )}
                          <span className="ml-2 text-xs text-slate-500">
                            {product.sku}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {unit?.price === null || unit?.price === undefined ? (
                            <span className="text-xs text-amber-700">
                              No price
                            </span>
                          ) : (
                            <Money value={unit.price} />
                          )}
                          <span className="block text-xs text-slate-500">
                            per {unit?.name}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <CartLines lines={lines} busy={busy} {...lineHandlers} />
        </div>

        <PaymentPanel
          state={payment}
          onChange={changePayment}
          total={total}
          customers={customers}
          accounts={accounts}
          onNewCustomer={() => setAddingCustomer(true)}
          busy={busy || repricing}
          canSubmit={canSubmit}
          onSubmit={() => void submit()}
        />
      </div>

      {addingCustomer && (
        <CustomerDialog
          brief
          onClose={() => setAddingCustomer(false)}
          onCreated={takeNewCustomer}
          // Already a customer: the sale goes in their name, nothing added.
          onPickExisting={takeNewCustomer}
          pickLabel="Use"
        />
      )}

      {choosing && (
        <OptionPicker
          scan={choosing}
          onCancel={() => {
            setChoosing(null);
            backToSearch();
          }}
          onPick={(option) => {
            const scan = choosing;
            setChoosing(null);
            if (addScanned(scan, option)) {
              setLastScanned({
                productId: scan.product.id,
                variantId: option.id,
              });
              setNotice(
                `Added ${optionLabel(scan.product.name, option.name)}.`,
              );
            }
          }}
        />
      )}

      {duplicate && (
        <DuplicateDialog
          conflict={duplicate}
          busy={busy}
          onCancel={() => setDuplicate(null)}
          // It is the same sale: nothing to record, and the cart goes.
          onClearCart={startNewSale}
          onRecordAnyway={() => {
            setRecordAnyway(true);
            setDuplicate(null);
            void submit({ allowDuplicate: true });
          }}
        />
      )}

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

/** The units the till may offer for a product, smallest first. */
function sellableUnits(product: ProductView): UnitOption[] {
  return product.units
    .filter((unit) => unit.isSellable)
    .sort((a, b) => a.factor - b.factor)
    .map((unit) => ({ id: unit.id, name: unit.name, factor: unit.factor }));
}

/**
 * What the till says about a unit with no price: no tier row, and no base
 * price to fall back on. The server would refuse the sale anyway; saying so
 * when the item is added is kinder than at the checkout, and the till never
 * fills the gap with a guess.
 */
function unpricedMessage(productName: string, unitName: string): string {
  return `${productName} has no price for the ${unitName} yet. Ask a manager to set one on the product.`;
}

/** The till's own search: active products, sellable units already priced. */
function tillSearch(
  text: string,
  tierId: string | null,
): Promise<TillSearchResult[]> {
  return api.get<TillSearchResult[]>(
    `/products/till-search?q=${encodeURIComponent(text)}` +
      (tierId ? `&tierId=${tierId}` : ''),
  );
}
