import { Field, Float, ID, ObjectType } from "@nestjs/graphql";
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Product } from "../product/product.entity";
import { Customer } from "../customer/customer.entity";

@ObjectType()
@Entity({ name: "sales" })
export class Sale {
  @Field(() => ID)
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Field(() => Product)
  @ManyToOne(() => Product, { eager: true })
  product: Product;

  @Field(() => Customer)
  @ManyToOne(() => Customer, { eager: true })
  customer: Customer;

  @Field()
  @Column("int")
  quantity: number;

  @Field(() => Float)
  @Column("float")
  total: number;

  @Field()
  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;
}
