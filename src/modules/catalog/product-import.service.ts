import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ImportProductsDto } from './dto/product-import.dto';
import { ImportReportView } from './dto/product-import.response';
import {
  planImport,
  type ImportContext,
  type ImportPlan,
} from './product-import';

/**
 * `POST /products/import`: a whole catalog from one spreadsheet.
 *
 * The rules are in `product-import.ts`; this reads what the catalog already
 * holds, plans against it, and — unless it is a preview — writes the plan.
 *
 * ## All or nothing, in a handful of queries
 *
 * One transaction, one `createMany` per table. Creating three hundred
 * products one by one, the way the form does, is several queries each — on
 * Render's free tier, where every round trip to the database is felt, that is
 * minutes, and a transaction held open that long. The ids are minted in the
 * plan, so every table can be written in a single statement.
 *
 * A save with any row still in error writes nothing. A retry after a save that
 * did land is harmless as well as idempotent: every name now exists, so every
 * row comes back as skipped.
 */
@Injectable()
export class ProductImportService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async run(input: ImportProductsDto): Promise<ImportReportView> {
    const plan = planImport(input.rows, await this.context());

    if (input.dryRun) return report(plan, false);

    if (plan.errors > 0) {
      throw new BadRequestException(
        `${plan.errors} ${plan.errors === 1 ? 'row has' : 'rows have'} a problem, so nothing was saved. Fix ${plan.errors === 1 ? 'it' : 'them'} in the spreadsheet and upload it again.`,
      );
    }
    if (plan.adding === 0) return report(plan, true);

    await this.write(plan);
    return report(plan, true);
  }

  private async context(): Promise<ImportContext> {
    const organizationId = TenantContext.requireOrganizationId();
    const [products, barcodes, categories, tier, organization] =
      await Promise.all([
        // Deleted products too: their SKUs still hold the unique constraint,
        // though their names are free to be used again.
        this.prisma.product.findMany({
          select: { name: true, sku: true, deletedAt: true },
        }),
        this.prisma.productBarcode.findMany({ select: { code: true } }),
        this.prisma.category.findMany({
          select: { id: true, name: true, deletedAt: true },
        }),
        this.prisma.priceTier.findFirst({
          where: { isDefault: true, deletedAt: null },
          select: { id: true },
        }),
        // Organization is not tenant-scoped — it is the tenant — so the id is
        // named.
        this.prisma.organization.findFirst({
          where: { id: organizationId },
          select: { businessType: true },
        }),
      ]);

    return {
      existingNames: new Set(
        products
          .filter((row) => !row.deletedAt)
          .map((row) => row.name.toLowerCase()),
      ),
      existingSkus: new Set(products.map((row) => row.sku)),
      existingBarcodes: new Set(barcodes.map((row) => row.code)),
      categories: categories.map((row) => ({
        id: row.id,
        name: row.name,
        deleted: row.deletedAt !== null,
      })),
      defaultTierId: tier?.id ?? null,
      businessType: organization?.businessType ?? BusinessType.mixed,
    };
  }

  private async write(plan: ImportPlan): Promise<void> {
    const organizationId = TenantContext.requireOrganizationId();
    const products = plan.rows.flatMap((row) =>
      row.status === 'add' && row.product ? [row.product] : [],
    );

    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (plan.revivedCategories.length > 0) {
            await tx.category.updateMany({
              where: {
                id: { in: plan.revivedCategories.map((row) => row.id) },
              },
              data: { deletedAt: null },
            });
          }
          if (plan.newCategories.length > 0) {
            await tx.category.createMany({
              data: plan.newCategories.map((row) => ({
                id: row.id,
                organizationId,
                name: row.name,
              })),
            });
          }

          await tx.product.createMany({
            data: products.map((product) => ({
              id: product.id,
              organizationId,
              sku: product.sku,
              name: product.name,
              size: product.size,
              categoryId: product.category?.id ?? null,
              basePrice: product.basePrice,
            })),
          });

          await tx.productUnit.createMany({
            data: products.flatMap((product) =>
              product.units.map((unit) => ({
                id: unit.id,
                organizationId,
                productId: product.id,
                name: unit.name,
                factor: unit.factor,
                isBase: unit.isBase,
                isSellable: unit.isSellable,
                isDefaultSelling: unit.isDefaultSelling,
              })),
            ),
          });

          // The counted-in unit's price is the base price, as on the form;
          // every bigger unit's goes on the default list.
          const prices = products.flatMap((product) =>
            product.units.flatMap((unit) =>
              !unit.isBase && unit.price !== null && plan.defaultTierId
                ? [
                    {
                      organizationId,
                      productId: product.id,
                      tierId: plan.defaultTierId,
                      unitId: unit.id,
                      price: unit.price,
                    },
                  ]
                : [],
            ),
          );
          if (prices.length > 0) {
            await tx.productPrice.createMany({ data: prices });
          }

          const barcodes = products.flatMap((product) =>
            product.barcode
              ? [
                  {
                    organizationId,
                    productId: product.id,
                    unitId: product.units.find((unit) => unit.isBase)!.id,
                    code: product.barcode.code,
                    symbology: product.barcode.symbology,
                  },
                ]
              : [],
          );
          if (barcodes.length > 0) {
            await tx.productBarcode.createMany({ data: barcodes });
          }
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        // Something the plan checked against was taken in the moments between
        // reading the catalog and writing it — another import, or somebody
        // adding a product by hand. Nothing was saved.
        throw new ConflictException(
          'Something in your products changed while this was being saved, so nothing was saved. Upload the file again to see what is new.',
        );
      }
      throw error;
    }
  }
}

function report(plan: ImportPlan, saved: boolean): ImportReportView {
  return {
    saved,
    adding: plan.adding,
    skipped: plan.skipped,
    errors: plan.errors,
    newCategories: [
      ...plan.newCategories.map((row) => row.name),
      ...plan.revivedCategories.map((row) => row.name),
    ],
    rows: plan.rows.map((row) => ({
      line: row.line,
      name: row.name,
      status: row.status,
      messages: row.messages,
      product: row.product && {
        name: row.product.name,
        sku: row.product.sku,
        size: row.product.size,
        category: row.product.category && {
          name: row.product.category.name,
          isNew: row.product.category.isNew,
        },
        units: row.product.units.map((unit) => ({
          name: unit.name,
          factor: unit.factor,
          price: unit.isBase ? row.product!.basePrice : unit.price,
          isBase: unit.isBase,
          isSellable: unit.isSellable,
          isDefaultSelling: unit.isDefaultSelling,
        })),
        barcode: row.product.barcode,
      },
    })),
  };
}
