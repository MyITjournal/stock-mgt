/**
 * Putting a recorded delivery right: the rules, with no database.
 *
 * ## What a correction is
 *
 * A delivery entered as 7 cartons when 6½ arrived, or the other way round. The
 * person states each line's **true** figures — received, paid for, and the
 * invoice value — in base units and kobo. Nothing is entered as a difference:
 * what someone knows is what the paperwork really said.
 *
 * From those, the plan works out what must move:
 *
 * - **Stock**: the difference in what arrived, as a movement on the line's own
 *   lot — out when fewer came, in when more did. The ledger is only added to.
 * - **The lot and the line**: set to the true figures, so stock value and the
 *   cost of future sales read right. Sales already made keep their cost.
 * - **The bill**: by the difference in value, so what is owed follows the
 *   invoice that was really sent.
 *
 * A line whose figures did not change is left out, and a correction that
 * changes nothing is refused rather than recorded as an empty event.
 *
 * ## The wrong product (2026-10-07)
 *
 * A line entered as Deep Impact **roll-on** when the lotion came. The person
 * names the right product and its figures; the recorded product's stock comes
 * back out of the line's own lot, the right product's goes in as a new lot at
 * the same cost, and the line names the right product — so the purchases
 * report and vendor targets count what really came. The value only moves the
 * bill if it changed too.
 *
 * ## Nothing arrived
 *
 * A line may be corrected to zero — an item that was on the paperwork and
 * never came. Its stock comes out and its value goes to zero; if the vendor
 * still charged for it, that is the bill's amount to change, not the goods.
 */

export interface RecordedLine {
  id: string;
  productId: string;
  batchId: string;
  /** Base units per unit the line was entered in. */
  unitFactor: number;
  quantityReceived: number;
  quantityPaidFor: number;
  totalCost: number;
}

export interface TrueFigures {
  lineId: string;
  /** The product that really arrived, when the line named the wrong one. */
  productId?: string;
  /** In base units. */
  received: number;
  /** In base units. */
  paidFor: number;
  /** In kobo — the invoice value of the line. */
  totalCost: number;
}

export interface LineChange {
  line: RecordedLine;
  /** The right product, when the line named the wrong one; else null. */
  newProductId: string | null;
  received: number;
  paidFor: number;
  totalCost: number;
  /**
   * Positive: more came than was entered. Negative: fewer. For a wrong
   * product, what goes in of the right one — the recorded product's whole
   * `line.quantityReceived` comes out.
   */
  stockDelta: number;
}

export interface CorrectionPlan {
  changes: LineChange[];
  /** The change in the delivery's value, which the bill moves by. */
  valueDelta: number;
  problems: string[];
}

export function planCorrection(
  recorded: readonly RecordedLine[],
  truths: readonly TrueFigures[],
): CorrectionPlan {
  const byId = new Map(recorded.map((line) => [line.id, line]));
  const problems: string[] = [];
  const changes: LineChange[] = [];
  const seen = new Set<string>();

  for (const truth of truths) {
    const line = byId.get(truth.lineId);
    if (!line) {
      problems.push('One of the lines is not on this delivery.');
      continue;
    }
    if (seen.has(line.id)) {
      problems.push('A line was given twice.');
      continue;
    }
    seen.add(line.id);

    if (truth.paidFor > truth.received) {
      problems.push(
        'More can’t have been paid for than arrived. Free goods are the ones received but not paid for.',
      );
      continue;
    }
    const newProductId =
      truth.productId && truth.productId !== line.productId
        ? truth.productId
        : null;
    if (newProductId && truth.received === 0) {
      problems.push(
        'Choose the product that did arrive, with how many came of it.',
      );
      continue;
    }
    if (truth.received === 0 && truth.totalCost !== 0) {
      problems.push(
        'Nothing arrived on a line, so its value is 0. If the vendor still charged for it, change the bill instead.',
      );
      continue;
    }
    const unchanged =
      !newProductId &&
      truth.received === line.quantityReceived &&
      truth.paidFor === line.quantityPaidFor &&
      truth.totalCost === line.totalCost;
    if (unchanged) continue;

    changes.push({
      line,
      newProductId,
      received: truth.received,
      paidFor: truth.paidFor,
      totalCost: truth.totalCost,
      stockDelta: newProductId
        ? truth.received
        : truth.received - line.quantityReceived,
    });
  }

  if (problems.length === 0 && changes.length === 0) {
    problems.push(
      'Nothing changed — the figures given are the ones already recorded.',
    );
  }

  return {
    changes,
    valueDelta: changes.reduce(
      (sum, change) => sum + (change.totalCost - change.line.totalCost),
      0,
    ),
    problems: [...new Set(problems)],
  };
}

/**
 * Which unit a corrected line is shown in: the **biggest of the product's own
 * units that holds both figures whole**, so 168 pieces shows as 7 cartons and
 * 156 as 156 pieces. Portions ("1/2 carton") are skipped — "13 × 1/2 carton"
 * says nothing a person would write. Chosen from the product, not the line, so
 * a line corrected to pieces and back again returns to cartons.
 */
export function displayUnit<U extends { name: string; factor: number }>(
  figures: { received: number; paidFor: number },
  units: readonly U[],
): U {
  const whole = units
    .filter((unit) => !/^\d+\s*\/\s*\d+\s/.test(unit.name))
    .filter(
      (unit) =>
        figures.received % unit.factor === 0 &&
        figures.paidFor % unit.factor === 0,
    )
    .sort((a, b) => b.factor - a.factor);
  // The base unit (factor 1) always divides, so there is always one.
  return whole[0] ?? units.find((unit) => unit.factor === 1)!;
}
