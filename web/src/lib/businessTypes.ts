import type { components } from '../api/schema';

export type BusinessType = components['schemas']['BusinessType'];

/**
 * What a shop owner reads, keyed by what the server stores.
 *
 * The descriptions are in trading terms — cartons, pieces, who walks in — not
 * in terms of what the setting does inside the app. Somebody choosing at
 * sign-up is answering "what kind of shop is this", and can answer that
 * without knowing what a base unit is.
 */
export const BUSINESS_TYPES: readonly {
  value: BusinessType;
  label: string;
  description: string;
}[] = [
  {
    value: 'retail',
    label: 'Retail shop',
    description: 'You sell to the final customer, often a piece at a time.',
  },
  {
    value: 'wholesale',
    label: 'Wholesale or distributor',
    description:
      'You sell packs, cartons and parts of a carton — never the single piece.',
  },
  {
    value: 'mixed',
    label: 'Both',
    description: 'You sell by the carton and break bulk for smaller buyers.',
  },
];

export function businessTypeLabel(value: BusinessType): string {
  return BUSINESS_TYPES.find((type) => type.value === value)?.label ?? value;
}
