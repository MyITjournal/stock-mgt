import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CategoryView } from './dto/product.response';

@Injectable()
export class CategoryService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateCategoryDto): Promise<CategoryView> {
    if (input.parentId) await this.findOneOrFail(input.parentId);

    // A name freed by a soft delete is still occupied as far as the unique
    // constraint is concerned, so re-adding "Beverages" would 409 on a row the
    // caller cannot see. Revive it instead — the same rule packaging types use.
    const buried = await this.prisma.category.findFirst({
      where: { name: input.name, deletedAt: { not: null } },
    });
    if (buried) {
      return this.prisma.category.update({
        where: { id: buried.id },
        data: {
          deletedAt: null,
          description: input.description ?? null,
          parentId: input.parentId ?? null,
        },
      });
    }

    try {
      return await this.prisma.category.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          name: input.name,
          description: input.description ?? null,
          parentId: input.parentId ?? null,
        },
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name);
    }
  }

  findAll(): Promise<CategoryView[]> {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdateCategoryDto): Promise<CategoryView> {
    await this.findOneOrFail(id);

    if (input.parentId) {
      if (input.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.findOneOrFail(input.parentId);
    }

    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
        },
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name ?? '');
    }
  }

  /**
   * Soft delete, refused while anything still files under the category.
   *
   * Letting it through would leave products pointing at a row the pickers no
   * longer list: the product page would still say "Beverages" while its edit
   * form showed no category and the filter could not find it. Clearing
   * `categoryId` instead would move past sales to "uncategorised" in every
   * report. So the person moves the products first — the same rule a bank
   * account with payments against it follows. Retired products count, because
   * their pages still show the category.
   */
  async remove(id: string) {
    const category = await this.findOneOrFail(id);

    const [products, children] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
      this.prisma.category.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (products > 0 || children > 0) {
      const blockers = [
        products > 0 &&
          `${products} ${products === 1 ? 'product' : 'products'}`,
        children > 0 &&
          `${children} ${children === 1 ? 'sub-category' : 'sub-categories'}`,
      ].filter(Boolean);
      throw new ConflictException(
        `${blockers.join(' and ')} ${products + children === 1 ? 'is' : 'are'} in "${category.name}". Move ${products + children === 1 ? 'it' : 'them'} to another category first.`,
      );
    }

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async findOneOrFail(id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  private translateUniqueViolation(error: unknown, name: string): Error {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(`A category named "${name}" already exists`);
    }
    return error as Error;
  }
}
