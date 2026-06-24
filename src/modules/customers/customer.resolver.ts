import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Customer } from "./customer.entity";
import { CustomerService } from "./customer.service";
import { CreateCustomerInput } from "./dto/create-customer.input";

@Resolver(() => Customer)
export class CustomerResolver {
  constructor(private svc: CustomerService) {}

  @Query(() => [Customer])
  customers() {
    return this.svc.findAll();
  }

  @Query(() => Customer, { nullable: true })
  customer(@Args("id") id: string) {
    return this.svc.findOne(id);
  }

  @Mutation(() => Customer)
  createCustomer(@Args("input") input: CreateCustomerInput) {
    return this.svc.create(input);
  }
}
