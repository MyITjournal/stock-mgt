import { BusinessType } from '@prisma/client';
import {
  DEFAULT_PRICE_TIER,
  WHOLESALE_PRICE_TIER,
  defaultPriceTierRows,
} from './price-tier.service';

const ORG = 'org-aaa';

describe('defaultPriceTierRows', () => {
  it('starts a retail shop on Retail alone', () => {
    expect(defaultPriceTierRows(ORG, BusinessType.retail)).toEqual([
      { organizationId: ORG, name: DEFAULT_PRICE_TIER, isDefault: true },
    ]);
  });

  it('starts a wholesaler on Wholesale, as the default its walk-in trader pays', () => {
    expect(defaultPriceTierRows(ORG, BusinessType.wholesale)).toEqual([
      { organizationId: ORG, name: WHOLESALE_PRICE_TIER, isDefault: true },
    ]);
  });

  it('gives a shop doing both lists, with Retail the default for walk-ins', () => {
    const rows = defaultPriceTierRows(ORG, BusinessType.mixed);
    expect(rows.map((row) => row.name)).toEqual([
      DEFAULT_PRICE_TIER,
      WHOLESALE_PRICE_TIER,
    ]);
    expect(rows.find((row) => row.isDefault)?.name).toBe(DEFAULT_PRICE_TIER);
  });

  it('always has exactly one default, whatever the type', () => {
    for (const type of Object.values(BusinessType)) {
      const defaults = defaultPriceTierRows(ORG, type).filter(
        (row) => row.isDefault,
      );
      expect(defaults).toHaveLength(1);
    }
  });

  it('stamps the organization on every row', () => {
    for (const type of Object.values(BusinessType)) {
      expect(
        defaultPriceTierRows(ORG, type).every(
          (row) => row.organizationId === ORG,
        ),
      ).toBe(true);
    }
  });
});
