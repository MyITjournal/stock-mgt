import type { BusinessType } from './businessTypes';

/**
 * Whether a unit starts out sold at the till, for a unit nobody has ticked or
 * unticked yet.
 *
 * **A preview of the server's rule, not the rule.** `defaultIsSellable` in
 * `src/modules/catalog/selling-units.ts` decides; the form only shows what it
 * will decide, and sends nothing for an untouched box so the server's answer is
 * the one stored. If the two ever disagree, the saved product shows the
 * server's — which is why the form never sends its guess.
 */
export function previewIsSellable(
  unit: { factor: number },
  unitCount: number,
  businessType: BusinessType,
): boolean {
  if (unitCount <= 1) return true;
  if (unit.factor !== 1) return true;
  return businessType !== 'wholesale';
}
