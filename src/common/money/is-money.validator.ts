import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

const MONEY_DESCRIPTION =
  'Amount in minor units (kobo for NGN), tax-inclusive. 2500 means ₦25.00.';

/**
 * Marks a DTO field as money: an integer count of minor units.
 *
 * Bundling the validation and the Swagger note together means every monetary
 * field in the API documents the same convention, rather than each DTO
 * describing it in its own words or not at all.
 */
export function IsMoney(
  options: {
    example?: number;
    optional?: boolean;
    /**
     * Allow a negative amount. Off by default, because almost every money
     * field here is a price or a total and a negative one is a bug. Payments
     * are the exception: the amount is signed so that cash handed back is the
     * same kind of row as cash taken in, the way `StockMovement.quantity` is
     * signed for stock leaving as well as arriving.
     */
    allowNegative?: boolean;
  } = {},
) {
  const { example = 250000, optional = false, allowNegative = false } = options;
  const description = allowNegative
    ? `${MONEY_DESCRIPTION} Signed: negative reverses the movement.`
    : MONEY_DESCRIPTION;

  return applyDecorators(
    optional
      ? ApiPropertyOptional({ example, description })
      : ApiProperty({ example, description }),
    IsInt({ message: '$property must be an integer number of minor units' }),
    ...(allowNegative ? [] : [Min(0)]),
  );
}
