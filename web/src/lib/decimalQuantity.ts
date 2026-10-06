/**
 * "6.5 cartons" as whole pieces — or a reason it cannot be.
 *
 * Stock is counted in whole base units everywhere (DECISIONS.md §15), and that
 * stays true: a person may *type* 6.5 against a carton, and this turns it into
 * the whole number of pieces it is — 6.5 × 14 = 91 — or refuses it when there
 * is no such number, as ½ of a carton of 15 is 7½ pieces. The ledger never
 * sees a fraction.
 *
 * Read as a decimal string, never through a float: "6.5" is 65 tenths, and 65
 * × 14 is divided by 10 exactly or not at all.
 */
export function toWholeBaseUnits(
  text: string,
  factor: number,
  unitName: string,
  baseName: string,
): { base: number } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { error: 'Enter how many.' };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return { error: `"${trimmed}" is not a number of ${unitName}.` };

  const decimals = match[2] ?? '';
  const scale = 10 ** decimals.length;
  const scaled = Number(match[1] + decimals) * factor;
  if (scaled % scale !== 0) {
    const exact = scaled / scale;
    return {
      error: `${trimmed} ${unitName} is ${exact.toFixed(2).replace(/\.?0+$/, '')} ${baseName} — not a whole number. Enter it in ${baseName}.`,
    };
  }
  return { base: scaled / scale };
}

/** Digits and one decimal point only, so the box can always be cleared. */
export function decimalDraft(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  return dot === -1
    ? cleaned
    : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}
