import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import type { SupplierPaymentDraft } from './PaySupplierDialog';

type SupplierPaymentView = components['schemas']['SupplierPaymentView'];

/**
 * Recording a vendor payment, wherever the Pay button is — the Bills list, a
 * bill opened from Money out. One mutation, so every door writes the same
 * request and refreshes the same way.
 */
export function usePaySupplier(onDone: () => void) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const pay = useMutation({
    mutationFn: (draft: SupplierPaymentDraft) =>
      api.post<SupplierPaymentView>('/supplier-payments', {
        id: crypto.randomUUID(),
        billId: draft.billId,
        amount: draft.amount,
        method: draft.method,
        ...(draft.bankAccountId && { bankAccountId: draft.bankAccountId }),
        ...(draft.reference && { reference: draft.reference }),
        ...(draft.note && { note: draft.note }),
        ...(draft.occurredAt && { occurredAt: draft.occurredAt }),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
      onDone();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not record that.',
      ),
  });

  return { pay, error, clearError: () => setError(null) };
}
