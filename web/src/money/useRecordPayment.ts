import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import type { PaymentDraft } from './RecordPaymentDialog';

type PaymentView = components['schemas']['PaymentView'];

/**
 * Recording a customer payment, wherever the button is — Invoices, Money in,
 * an invoice marked paid. One mutation, so every door sends the same request.
 */
export function useRecordPayment(onDone: () => void) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: (draft: PaymentDraft) =>
      api.post<PaymentView>('/payments', {
        id: crypto.randomUUID(),
        ...(draft.customerId && { customerId: draft.customerId }),
        amount: draft.amount,
        method: draft.method,
        ...(draft.bankAccountId && { bankAccountId: draft.bankAccountId }),
        ...(draft.reference && { reference: draft.reference }),
        ...(draft.note && { note: draft.note }),
        ...(draft.allocations.length > 0 && {
          allocations: draft.allocations,
        }),
        ...(draft.occurredAt && { occurredAt: draft.occurredAt }),
        ...(draft.locationId && { locationId: draft.locationId }),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
      onDone();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that payment.',
      ),
  });

  return { record, error, clearError: () => setError(null) };
}
