import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Sale } from "./sale.entity";
import { SaleService } from "./sale.service";
import { CreateSaleInput } from "./dto/create-sale.input";

@Resolver(() => Sale)
export class SaleResolver {
  constructor(private svc: SaleService) {}

  @Query(() => [Sale])
  sales() {
    return this.svc.findAll();
  }

  @Query(() => Sale, { nullable: true })
  sale(@Args("id") id: string) {
    return this.svc.findOne(id);
  }

  @Mutation(() => Sale)
  createSale(@Args("input") input: CreateSaleInput) {
    return this.svc.create(input);
  }
}
