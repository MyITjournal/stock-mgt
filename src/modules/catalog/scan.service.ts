import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BarcodeSymbology } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { splitTaxInclusive } from '../../common/money/money';
import { detectSymbology, normaliseCode } from './barcode';

export interface ScanResult {
  code: string;
  symbology: BarcodeSymbology;
  product: { id: string; sku: string; name: string; trackStock: boolean };
  unit: { id: string; name: string; factor: number };
  /** How many base units one scan of this code represents. */
  baseQuantity: number;
  price: number;
  isTierPrice: boolean;
  tax: { gross: number; net: number; tax: number };
}

/**
 * The single seam every scan goes through.
 *
 * Sales, goods receiving, stocktake and returns all resolve a scanned code
 * here rather than each querying barcodes directly. That is what keeps a future
 * identifier technology — RFID EPCs, QR payloads — an addition to this one
 * method instead of surgery across the inventory and sales paths.
 */
@Injectable()
export class ScanService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async resolve(rawCode: string, tierId?: string): Promise<ScanResult> {
    const code = normaliseCode(rawCode);

    const barcode = await this.prisma.productBarcode.findFirst({
      where: { code },
      include: {
        unit: true,
        product: { include: { prices: true } },
      },
    });

    if (!barcode || barcode.product.deletedAt) {
      throw new NotFoundException(
        `No product is registered against the code "${code}"`,
      );
    }

    const { product, unit } = barcode;

    // Tier price for this exact unit, else the base price scaled by the factor.
    const tiered = tierId
      ? product.prices.find((p) => p.tierId === tierId && p.unitId === unit.id)
      : undefined;
    const price = tiered ? tiered.price : product.basePrice * unit.factor;

    return {
      code,
      symbology: barcode.symbology,
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        trackStock: product.trackStock,
      },
      unit: { id: unit.id, name: unit.name, factor: unit.factor },
      // Scanning a carton must add 24 pieces to stock, not 1 anonymous item.
      baseQuantity: unit.factor,
      price,
      isTierPrice: Boolean(tiered),
      tax: splitTaxInclusive(price, product.taxRateBps),
    };
  }

  /** What a code looks like, without touching the database. */
  identify(rawCode: string) {
    const code = normaliseCode(rawCode);
    return { code, symbology: detectSymbology(code) };
  }
}
