import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { components } from '../api/schema';

type ProductView = components['schemas']['ProductView'];
export type ProductUnitView = components['schemas']['ProductUnitView'];

/**
 * The units a product can be counted in, smallest first.
 *
 * Fetched rather than guessed, because **quantities are integers everywhere**
 * and a fraction of a bigger unit is a whole number of smaller ones
 * (DECISIONS.md §15). Somebody writing off two cartons should say "2" and
 * "carton"; making them work out that it is 24 pieces is how a 23 gets typed.
 *
 * The base unit — `factor = 1` — is what the ledger counts in and what every
 * quantity on screen is reported in.
 */
export function useProductUnits(productId: string | null) {
  const { data } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.get<ProductView>(`/products/${productId ?? ''}`),
    enabled: Boolean(productId),
  });

  const units = data?.units ?? [];
  return {
    units,
    baseUnit: units.find((unit) => unit.factor === 1) ?? units[0],
  };
}

/** `2 cartons` in base units, given the factor. Integers throughout. */
export function toBaseUnits(quantity: number, factor: number): number {
  return quantity * factor;
}
