import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { multiply } from '../../common/money/money';

@Injectable()
export class SaleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSaleDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const customer = await this.prisma.customer.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const total = input.total ?? multiply(product.price, input.quantity);

    return this.prisma.sale.create({
      data: {
        productId: input.productId,
        customerId: input.customerId,
        quantity: input.quantity,
        total,
      },
      include: { product: true, customer: true },
    });
  }

  findAll() {
    return this.prisma.sale.findMany({
      include: { product: true, customer: true },
    });
  }

  findOne(id: string) {
    return this.prisma.sale.findUnique({
      where: { id },
      include: { product: true, customer: true },
    });
  }
}
