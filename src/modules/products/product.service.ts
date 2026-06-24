import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Product } from "./product.entity";
import { CreateProductInput } from "./dto/create-product.input";
import { UpdateProductInput } from "./dto/update-product.input";

@Injectable()
export class ProductService {
  constructor(@InjectRepository(Product) private repo: Repository<Product>) {}

  create(input: CreateProductInput) {
    const p = this.repo.create(input);
    return this.repo.save(p);
  }

  findAll() {
    return this.repo.find();
  }

  findOne(id: string) {
    return this.repo.findOneBy({ id });
  }

  async update(input: UpdateProductInput) {
    await this.repo.update(input.id, input as any);
    return this.findOne(input.id);
  }

  remove(id: string) {
    return this.repo.delete({ id });
  }
}
