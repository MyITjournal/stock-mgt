import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';
import { MAX_LINES_PER_REQUEST } from '../../../common/pagination/request-limits';

/** The price really charged for one line. */
export class CorrectLinePriceDto {
  @ApiProperty({ format: 'uuid', description: 'The sale line.' })
  @IsUUID()
  lineId!: string;

  @IsMoney({ example: 450000 })
  /** Tax-inclusive price of one of the line's units, as the till takes it. */
  unitPrice!: number;
}

/**
 * Putting a recorded sale right (2026-10-08): the prices really charged, the
 * customer it really was, or both, and why. Owner or manager.
 */
export class CorrectSaleDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The correction’s own id. Sent again on a retry, it returns the sale as corrected rather than correcting it twice.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Owner gave ₦500 off each carton.' })
  @IsString()
  @MinLength(3, {
    message: 'Say why it is being corrected — a few words will do.',
  })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The customer it really was. Omitted: unchanged. Null: a walk-in. Prices are not re-worked from their price list.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @ApiPropertyOptional({
    type: [CorrectLinePriceDto],
    description:
      'Only the lines whose price changes. A line left out keeps its price.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CorrectLinePriceDto)
  lines?: CorrectLinePriceDto[];
}
