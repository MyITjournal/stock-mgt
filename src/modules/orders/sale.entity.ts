import { Customer } from '../customers/customer.entity';

export class Sale {
  id: string;
  organizationId: string;
  productId: string;
  customerId: string;
  customer: Customer;
  quantity: number;
  /** Tax-inclusive, in minor units (kobo). */
  total: number;
  createdAt: Date;
}
