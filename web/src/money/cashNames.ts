import type { components } from '../api/schema';

type CashPersonView = components['schemas']['CashPersonView'];

/** A person as Money → Cash names them. */
export function personName(person: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return (
    [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Unnamed'
  );
}

export const BANKING_STATUS_LABEL: Record<string, string> = {
  waiting: 'Waiting to confirm',
  confirmed: 'Confirmed',
  not_received: 'Not received',
};

/** A person with nothing to account for yet. */
export function emptyRow(userId: string): CashPersonView {
  return {
    userId,
    firstName: null,
    lastName: null,
    received: 0,
    paidOut: 0,
    banked: 0,
    waiting: 0,
    stillHolding: 0,
    oldestUnbankedAt: null,
    overdue: false,
  };
}
