import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';
import { IsPlausibleOccurrence } from '../../../common/validation/is-occurrence.validator';

/**
 * Recording what is already owed, for goods that arrived before this system
 * knew about them.
 *
 * **This deliberately creates no stock.** The goods on an opening balance were
 * received — and in most cases sold — long before anybody typed this in, so
 * inventing movements for them would break the invariant that every movement
 * sums to the stock levels. A bill with no goods receipt is a debt and nothing
 * else.
 *
 * The normal path is not this endpoint: a delivery recorded through
 * `POST /goods-receipts` raises its own bill.
 */
export class CreateSupplierBillDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({
    example: 19_980_000,
    description:
      'What the vendor is owed for this supply, in kobo — their invoice total, including anything that is not a stock line such as a delivery charge.',
  })
  @IsMoney({ example: 19_980_000 })
  amountDue!: number;

  @ApiPropertyOptional({
    example: 'DN-40318',
    description: 'The vendor’s own invoice or delivery-note number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceNumber?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the vendor supplied the goods — the date their statement will show, not today. Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  @IsPlausibleOccurrence()
  issuedAt?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When you intend to settle, if you have said. Optional, and moving it later is expected.',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'Opening balance carried in at go-live.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * Correcting a bill — most often `amountDue`, when the vendor's invoice turns
 * out to carry a delivery charge the goods lines never knew about.
 *
 * `supplierId` and `id` are deliberately not updatable. A bill that changes
 * vendor is a different debt, and the payments already sitting against it would
 * silently follow it there. Delete and re-enter instead.
 */
export class UpdateSupplierBillDto extends PartialType(
  OmitType(CreateSupplierBillDto, ['id', 'supplierId'] as const),
) {}
