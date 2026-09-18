import { OrgRole } from '@prisma/client';
import { TenantContext } from '../tenancy/tenant-context';
import {
  SEES_COST,
  callerSeesCost,
  redactCost,
  redactCostAll,
} from './cost-visibility';

const as = <T>(orgRole: OrgRole | undefined, fn: () => T): T =>
  TenantContext.run({ organizationId: 'org-1', userId: 'user-1', orgRole }, fn);

describe('cost visibility', () => {
  describe('who may see what the goods cost', () => {
    it('lets the three roles that set prices see it', () => {
      for (const role of SEES_COST) {
        expect(as(role, callerSeesCost)).toBe(true);
      }
    });

    it.each([OrgRole.sales_rep, OrgRole.storekeeper])(
      'does not let a %s see it',
      (role) => {
        expect(as(role, callerSeesCost)).toBe(false);
      },
    );

    it('says no when there is no role at all', () => {
      // A cron or a bootstrap task has no tenant store. Answering "no" outside
      // a request is the direction that fails closed.
      expect(callerSeesCost()).toBe(false);
      expect(as(undefined, callerSeesCost)).toBe(false);
    });
  });

  describe('redactCost', () => {
    const line = { id: 'line-1', quantity: 4, costOfGoodsSold: 250_000 };

    it('hands the row back untouched to a role that may see cost', () => {
      const result = as(OrgRole.owner, () =>
        redactCost(line, ['costOfGoodsSold']),
      );

      expect(result).toEqual(line);
    });

    it('removes the field entirely for a role that may not', () => {
      const result = as(OrgRole.sales_rep, () =>
        redactCost(line, ['costOfGoodsSold']),
      );

      // Absent, not null or zero: a zero would be read as "these goods were
      // free" by anything that adds the column up.
      expect(result).not.toHaveProperty('costOfGoodsSold');
      expect(result).toEqual({ id: 'line-1', quantity: 4 });
    });

    it('does not mutate the row it was given', () => {
      as(OrgRole.sales_rep, () => redactCost(line, ['costOfGoodsSold']));

      // The caller's row is often a Prisma result that something else still
      // needs in full — the return costing reads `costOfGoodsSold` off one.
      expect(line.costOfGoodsSold).toBe(250_000);
    });

    it('drops several fields at once', () => {
      const result = as(OrgRole.storekeeper, () =>
        redactCost({ ...line, costIsEstimated: true }, [
          'costOfGoodsSold',
          'costIsEstimated',
        ]),
      );

      expect(result).toEqual({ id: 'line-1', quantity: 4 });
    });
  });

  describe('redactCostAll', () => {
    const rows = [
      { sku: 'a', costPrice: 100 },
      { sku: 'b', costPrice: 200 },
    ];

    it('redacts every row for a rep', () => {
      const result = as(OrgRole.sales_rep, () =>
        redactCostAll(rows, ['costPrice']),
      );

      expect(result).toEqual([{ sku: 'a' }, { sku: 'b' }]);
    });

    it('leaves the list alone for an accountant', () => {
      const result = as(OrgRole.accountant, () =>
        redactCostAll(rows, ['costPrice']),
      );

      expect(result).toEqual(rows);
    });
  });
});
