import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        name: input.name,
        price: input.price,
        description: input.description ?? null,
      },
    });
  }

  findAll() {
    return this.prisma.product.findMany();
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdateProductDto) {
    await this.findOneOrFail(id);

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
      },
    });
  }

  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.product.delete({ where: { id } });
  }

  private async findOneOrFail(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}
