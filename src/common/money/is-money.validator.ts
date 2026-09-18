import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

const MONEY_DESCRIPTION =
  'Amount in minor units (kobo for NGN), tax-inclusive. 2500 means ₦25.00.';

/**
 * The largest amount any money column can hold: Postgres `int4`, which is what
 * every money field in the schema is.
 *
 * ₦21,474,836.47. Generous for a single figure in this market and, more to the
 * point, the actual ceiling — without it an amount above it reached the database
 * and came back as a 500 with a driver message, rather than a 400 saying the
 * number is too big. Overflow is not a security hole here (Postgres raises
 * rather than wrapping), but a write path that answers 500 to bad input is one
 * nobody can debug from the outside.
 */
export const MAX_MINOR_UNITS = 2_147_483_647;

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
    Max(MAX_MINOR_UNITS),
    ...(allowNegative ? [Min(-MAX_MINOR_UNITS)] : [Min(0)]),
  );
}
