import { OrgRole } from '@prisma/client';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { withPrints } from './prints';

describe('withPrints', () => {
  const row = {
    id: 'sale-1',
    _count: { prints: 2 },
    prints: [{ copy: 1 }, { copy: 2 }],
  };
  const as = (orgRole: OrgRole) =>
    TenantContext.run(
      { organizationId: 'org-1', userId: 'user-1', orgRole },
      () => withPrints(row),
    );

  it('gives an owner or manager the count and who made each copy', () => {
    for (const role of [OrgRole.owner, OrgRole.manager]) {
      const seen = as(role);
      expect(seen).toMatchObject({ printCount: 2, prints: row.prints });
      expect(seen).not.toHaveProperty('_count');
    }
  });

  it('removes both for staff, rather than saying "never printed"', () => {
    for (const role of [OrgRole.sales_rep, OrgRole.storekeeper]) {
      const seen = as(role);
      expect(seen).toEqual({ id: 'sale-1' });
    }
  });

  it('removes both outside a request, the safe direction', () => {
    expect(withPrints(row)).toEqual({ id: 'sale-1' });
  });

  it('counts nothing for a row read without the count', () => {
    const bare: { id: string; _count?: { prints: number } } = { id: 'sale-1' };
    const seen = TenantContext.run(
      { organizationId: 'org-1', userId: 'user-1', orgRole: OrgRole.owner },
      () => withPrints(bare),
    );
    expect(seen).toEqual({ id: 'sale-1', printCount: 0 });
  });
});
