import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';

/**
 * Removing a customer added by mistake (2026-10-07).
 *
 * The server only allows it for a customer with **no invoices and no
 * payments**; anyone with history stays, and the refusal says to merge a
 * duplicate instead. Asked twice — one tap shows "Remove for good?" — because
 * nothing on screen brings a customer back.
 */
export function RemoveCustomerButton({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/customers/${customerId}`),
    onSuccess: () => {
      afterWrite(queryClient);
      navigate('/customers', { replace: true });
    },
    onError: (caught) => {
      setAsking(false);
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not remove this customer.',
      );
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      {asking ? (
        <span className="inline-flex items-center gap-2">
          <span className="text-sm text-slate-700">Remove for good?</span>
          <Button
            variant="secondary"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? 'Removing…' : 'Yes, remove'}
          </Button>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            No
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
        >
          Remove
        </Button>
      )}
      {error && (
        <span className="max-w-xs text-right text-xs text-red-700" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
