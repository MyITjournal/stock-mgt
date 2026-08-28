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
  options: { example?: number; optional?: boolean } = {},
) {
  const { example = 250000, optional = false } = options;

  return applyDecorators(
    optional
      ? ApiPropertyOptional({ example, description: MONEY_DESCRIPTION })
      : ApiProperty({ example, description: MONEY_DESCRIPTION }),
    IsInt({ message: '$property must be an integer number of minor units' }),
    Min(0),
  );
}
