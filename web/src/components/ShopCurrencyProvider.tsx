import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { useAuth } from '../auth/useAuth';
import { ShopCurrencyContext } from '../lib/shopCurrency';

type OrganizationView = components['schemas']['OrganizationView'];

/**
 * Makes the shop's currency every `<Money>`'s default.
 *
 * Shares the `['organization']` query with Settings and the product form, so
 * it costs one request a session and a currency changed in Settings shows on
 * every screen as soon as that write's refetch lands. Nothing is asked before
 * somebody is signed in — the sign-in and sign-up screens show no money.
 */
export function ShopCurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<OrganizationView>('/organization'),
    enabled: user !== null,
  });

  return (
    <ShopCurrencyContext.Provider value={data?.currency ?? 'NGN'}>
      {children}
    </ShopCurrencyContext.Provider>
  );
}
