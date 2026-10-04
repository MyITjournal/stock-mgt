import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { resolveUnitPrice } from './pricing';
import { resolveTierId } from './price-tier.service';
import { detectSymbology, normaliseCode } from './barcode';
import { ScanResult } from './dto/scan.response';

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

    // The same rule as GET /products/:id/price and the sale path, not a copy
    // of it: this used to repeat the arithmetic inline, which is exactly how a
    // change to the rule reaches two callers and misses the third.
    const priced = resolveUnitPrice(
      product,
      unit,
      await resolveTierId(this.prisma, tierId),
    );

    return {
      code,
      symbology: barcode.symbology,
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        size: product.size,
        trackStock: product.trackStock,
      },
      unit: {
        id: unit.id,
        name: unit.name,
        factor: unit.factor,
        isSellable: unit.isSellable,
      },
      // Scanning a carton must add 24 pieces to stock, not 1 anonymous item.
      baseQuantity: unit.factor,
      price: priced.price,
      isTierPrice: priced.isTierPrice,
      tax: priced.tax,
    };
  }

  /** What a code looks like, without touching the database. */
  identify(rawCode: string) {
    const code = normaliseCode(rawCode);
    return { code, symbology: detectSymbology(code) };
  }
}
