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

@Injectable()
export class CategoryService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateCategoryDto) {
    if (input.parentId) await this.findOneOrFail(input.parentId);

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

  findAll() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdateCategoryDto) {
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

  /** Soft delete: products keep pointing at the row for historical reporting. */
  async remove(id: string) {
    await this.findOneOrFail(id);
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
