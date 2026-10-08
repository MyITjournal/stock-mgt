import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { useAuth } from '../auth/useAuth';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { Spinner } from '../auth/RequireAuth';
import { BankingList } from '../money/BankingList';
import { RecordBankingDialog } from '../money/RecordBankingDialog';
import { CashStat, OldestUnbanked } from '../money/CashPage';
import { emptyRow } from '../money/cashNames';

type CashView = components['schemas']['CashView'];

/**
 * Sales → My cash: the cash I took, and banking it (2026-10-08).
 *
 * Under Sales because that is where a cashier works — Money is not theirs to
 * open. Everyone sees only their own here, the owner included; Money → Cash is
 * the view of everybody.
 */
export function MyCashPage() {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['cash'],
    queryFn: () => api.get<CashView>('/cash'),
  });

  if (isPending || !user) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Counting your cash" />
      </div>
    );
  }

  const me =
    data?.people.find((person) => person.userId === user.sub) ??
    emptyRow(user.sub);

  return (
    <Page
      title="My cash"
      description="Cash you took, and where it is now. Record it when you bank it or hand it to the owner."
      actions={
        <Button
          onClick={() => setRecording(true)}
          disabled={me.stillHolding <= 0}
        >
          Record cash banked
        </Button>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CashStat
          label="Still holding"
          value={<Money value={me.stillHolding} signed />}
          note={
            me.oldestUnbankedAt ? (
              <>
                Oldest from{' '}
                <OldestUnbanked at={me.oldestUnbankedAt} overdue={me.overdue} />
              </>
            ) : (
              'Nothing to bank.'
            )
          }
          warn={me.overdue}
        />
        <CashStat
          label="Waiting to confirm"
          value={<Money value={me.waiting} />}
          note="Recorded as banked; the owner or a manager checks it."
        />
        <CashStat label="Banked" value={<Money value={me.banked} />} />
        <CashStat
          label="Received in cash"
          value={<Money value={me.received} />}
        />
        <CashStat
          label="Paid out in cash"
          value={<Money value={me.paidOut} />}
          note="Refunds and anything paid from the till."
        />
      </section>

      <BankingList showWho={false} onlyUserId={user.sub} />

      {recording && (
        <RecordBankingDialog
          people={[me]}
          initialPerson={me.userId}
          onClose={() => setRecording(false)}
        />
      )}
    </Page>
  );
}
