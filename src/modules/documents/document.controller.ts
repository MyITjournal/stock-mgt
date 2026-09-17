import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { DocumentService } from './document.service';

@ApiTags('documents')
@ApiBearerAuth('JWT')
@Controller()
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get('sales/:id/invoice.pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'The printable invoice for a sale',
    description:
      'The document a customer is sent to pay from: letterhead, lines, the VAT split shown as *of which* rather than added on, and the accounts to pay into. `GET /sales/:id/receipt` remains the narrow JSON payload a thermal printer uses — this is deliberately a different document for a different reader.',
  })
  async invoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.documents.invoicePdf(id);
    return send(res, buffer, filename);
  }

  @Get('customers/:id/statement.pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'A customer’s statement of account, printable',
    description:
      'What they owe, what they have paid, and how long each invoice has been outstanding. Lists payments as well as debts on purpose: a statement showing only what is owed reads as an accusation and invites a dispute about money that was in fact received.',
  })
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.documents.statementPdf(id);
    return send(res, buffer, filename);
  }
}

/**
 * `inline` rather than `attachment`: these are most often opened on a phone and
 * forwarded over WhatsApp, and a forced download is one more step between the
 * customer and paying.
 */
function send(res: Response, buffer: Buffer, filename: string) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Length': String(buffer.length),
  });
  res.end(buffer);
}
