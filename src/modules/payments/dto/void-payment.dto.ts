import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidPaymentDto {
  /**
   * Required, and deliberately so — the same rule a forced stock movement
   * obeys. A void with no reason is indistinguishable from a payment quietly
   * disappearing, which is exactly what somebody reading the row later needs
   * to rule out.
   */
  @ApiProperty({
    example: 'Keyed ₦500,000 instead of ₦50,000; corrected on the next row.',
    description: 'Why this payment should never have existed.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
