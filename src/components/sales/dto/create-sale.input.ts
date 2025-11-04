import { Field, Float, InputType } from "@nestjs/graphql";

@InputType()
export class CreateSaleInput {
  @Field()
  productId: string;

  @Field()
  customerId: string;

  @Field()
  quantity: number;

  @Field(() => Float, { nullable: true })
  total?: number;
}
