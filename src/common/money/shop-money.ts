import { TenantContext } from '../tenancy/tenant-context';
import { DEFAULT_CURRENCY } from './currencies';
import { formatMinor, type Minor } from './money';

/** Anything that can read the organization row — the client or a transaction. */
interface ReadsOrganization {
  organization: {
    findFirst(args: {
      where: { id: string };
      select: { currency: true };
    }): Promise<{ currency: string } | null>;
  };
}

/** For a message a person reads, in the shop's own currency: ₦12,500.00. */
export async function shopMoney(
  db: ReadsOrganization,
): Promise<(minor: Minor) => string> {
  const organization = await db.organization.findFirst({
    where: { id: TenantContext.requireOrganizationId() },
    select: { currency: true },
  });
  const currency = organization?.currency ?? DEFAULT_CURRENCY;
  return (minor) => formatMinor(minor, currency);
}
