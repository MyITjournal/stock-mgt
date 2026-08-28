export class Customer {
  id!: string;
  firstName!: string;
  middleName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
