import { Product } from '../products/product.entity';
import { Customer } from '../customers/customer.entity';

export class Sale {
  id: string;
  productId: string;
  customerId: string;
  product: Product;
  customer: Customer;
  quantity: number;
  total: number;
  createdAt: Date;
}
