import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Product } from "./product.entity";
import { ProductService } from "./product.service";
import { CreateProductInput } from "./dto/create-product.input";
import { UpdateProductInput } from "./dto/update-product.input";

@Resolver(() => Product)
export class ProductResolver {
  constructor(private svc: ProductService) {}

  @Query(() => [Product])
  products() {
    return this.svc.findAll();
  }

  @Query(() => Product, { nullable: true })
  product(@Args("id") id: string) {
    return this.svc.findOne(id);
  }

  @Mutation(() => Product)
  createProduct(@Args("input") input: CreateProductInput) {
    return this.svc.create(input);
  }

  @Mutation(() => Product)
  updateProduct(@Args("input") input: UpdateProductInput) {
    return this.svc.update(input);
  }
}
