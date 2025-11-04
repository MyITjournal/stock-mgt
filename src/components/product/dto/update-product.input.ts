import { Field, Float, InputType } from "@nestjs/graphql";

@InputType()
export class UpdateProductInput {
  @Field()
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field(() => Float, { nullable: true })
  price?: number;

  @Field({ nullable: true })
  description?: string;
}
