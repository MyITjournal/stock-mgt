import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Sale } from "./sale.entity";
import { CreateSaleInput } from "./dto/create-sale.input";
import { Product } from "../product/product.entity";
import { Customer } from "../customer/customer.entity";

@Injectable()
export class SaleService {
  constructor(
    @InjectRepository(Sale) private repo: Repository<Sale>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>
  ) {}

  async create(input: CreateSaleInput) {
    const product = await this.productRepo.findOneBy({ id: input.productId });
    if (!product) throw new NotFoundException("Product not found");
    const customer = await this.customerRepo.findOneBy({
      id: input.customerId,
    });
    if (!customer) throw new NotFoundException("Customer not found");

    const total = input.total ?? product.price * input.quantity;
    const sale = this.repo.create({
      product,
      customer,
      quantity: input.quantity,
      total,
    });
    return this.repo.save(sale);
  }

  findAll() {
    return this.repo.find();
  }

  findOne(id: string) {
    return this.repo.findOneBy({ id });
  }
}
