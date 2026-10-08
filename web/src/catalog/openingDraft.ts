/** What is on the shelf, as typed into Add product (2026-10-08). */
export interface OpeningDraft {
  /** The unit row it is counted in, by the form's row key. */
  unitKey: string;
  /** As typed: digits and one dot. Empty means none — the section is optional. */
  quantity: string;
  /** What one of that unit cost, in minor units. */
  unitCost: number | null;
  expiryDate: string;
  locationId: string;
}

export const EMPTY_OPENING: OpeningDraft = {
  unitKey: '',
  quantity: '',
  unitCost: null,
  expiryDate: '',
  locationId: '',
};
