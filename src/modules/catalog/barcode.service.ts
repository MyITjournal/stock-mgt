import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BarcodeSymbology } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  detectSymbology,
  generateInternalCode,
  hasValidCheckDigit,
  normaliseCode,
  requiresCheckDigit,
} from './barcode';
import { CreateBarcodeDto } from './dto/barcode.dto';

@Injectable()
export class BarcodeService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(productId: string, input: CreateBarcodeDto) {
    const unit = await this.prisma.productUnit.findFirst({
      where: { id: input.unitId, productId },
    });
    if (!unit) {
      throw new BadRequestException(
        'That unit does not belong to this product',
      );
    }

    // No code supplied means the goods arrived unbarcoded, which is common for
    // repacks and local products: mint one in the internal range.
    const generated = !input.code;
    const code = generated
      ? generateInternalCode()
      : normaliseCode(input.code as string);

    const symbology = input.symbology ?? detectSymbology(code);

    if (
      !generated &&
      requiresCheckDigit(symbology) &&
      !hasValidCheckDigit(code)
    ) {
      throw new BadRequestException(
        `"${code}" is not a valid ${symbology}: the check digit does not match. Re-scan or re-key it.`,
      );
    }

    try {
      const barcode = await this.prisma.productBarcode.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          productId,
          unitId: input.unitId,
          code,
          symbology,
          isPrimary: input.isPrimary ?? false,
        },
        include: { unit: true },
      });

      if (barcode.isPrimary)
        await this.clearOtherPrimaries(unit.id, barcode.id);
      return barcode;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `The barcode "${code}" is already assigned to another product in this organization`,
        );
      }
      throw error;
    }
  }

  findForProduct(productId: string) {
    return this.prisma.productBarcode.findMany({
      where: { productId },
      include: { unit: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async remove(id: string) {
    const barcode = await this.prisma.productBarcode.findFirst({
      where: { id },
    });
    if (!barcode) throw new NotFoundException('Barcode not found');

    await this.prisma.productBarcode.delete({ where: { id } });
  }

  /** One primary code per unit, so label printing is unambiguous. */
  private async clearOtherPrimaries(unitId: string, keepId: string) {
    await this.prisma.productBarcode.updateMany({
      where: { unitId, id: { not: keepId }, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}

export { BarcodeSymbology };

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
