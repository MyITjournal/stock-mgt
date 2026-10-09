import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const INVOICE_PURPOSES = ['print', 'open'] as const;
export type InvoicePurpose = (typeof INVOICE_PURPOSES)[number];

export class InvoicePdfQuery {
  @ApiPropertyOptional({
    enum: INVOICE_PURPOSES,
    description:
      'What the copy is for, as the owner reads it in the sale’s history: `print` from a Print button, `open` to look at or share. Either way it is counted (2026-10-09). Defaults to `open`.',
  })
  @IsOptional()
  @IsIn(INVOICE_PURPOSES as unknown as string[])
  purpose?: InvoicePurpose;
}
