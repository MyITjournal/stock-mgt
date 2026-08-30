import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { PaymentService } from './payment.service';
import { ReceivableService } from './receivable.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';

/**
 * Taking money is the counter's job and the rep's on the route; reconciling it
 * is the accountant's. This is the first slice where that role does anything.
 */
const MONEY_HANDLERS = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.accountant,
  OrgRole.sales_rep,
];

@ApiTags('payments')
@ApiBearerAuth('JWT')
@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'since', required: false, description: 'ISO date-time.' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'List payments, paged for delta sync',
    description:
      'Keyset paging over (createdAt, id), the same shape sales and the stock ledger use.',
  })
  findAll(
    @Query('customerId') customerId?: string,
    @Query('since') since?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.payments.findAll({
      customerId,
      since: since ? new Date(since) : undefined,
      cursor,
      limit,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a payment',
    description: 'With what it settled, and anything left over as credit.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(id);
  }

  @Post()
  @Roles(...MONEY_HANDLERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original payment instead of banking it twice.',
  })
  @ApiOperation({
    summary: 'Record a payment',
    description:
      'One row per thing that happened: a single transfer settling three invoices is one payment with three allocations, so it still matches the bank statement. Omit `allocations` to settle the oldest invoices first; anything not allocated stays as credit on the customer. A negative amount is money handed back.',
  })
  create(@Body() dto: CreatePaymentDto) {
    return this.payments.create(dto);
  }

  @Post(':id/void')
  @Roles(OrgRole.owner, OrgRole.manager, OrgRole.accountant)
  @ApiOperation({
    summary: 'Void a payment that should never have been recorded',
    description:
      'For a data-entry mistake — a mis-keyed amount, a collection booked against the wrong customer. **Not** for a refund: money genuinely handed back is a negative payment, because it happened. The row is kept with its reason and whoever voided it, and stops counting toward any balance, so the invoices it had settled go back to being owed. A sales rep cannot void; correcting a collection is a supervisor’s call.',
  })
  voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidPaymentDto,
  ) {
    return this.payments.voidPayment(id, dto);
  }
}

@ApiTags('payments')
@ApiBearerAuth('JWT')
@Controller()
export class ReceivableController {
  constructor(private readonly receivables: ReceivableService) {}

  @Get('receivables')
  @ApiQuery({ name: 'customerId', required: false })
  @ApiOperation({
    summary: 'Who owes me',
    description:
      'Every invoice with money still on it, longest outstanding first, with a total per customer. A list rather than 30/60/90 buckets — the question people actually ask is who has owed longest.',
  })
  outstanding(@Query('customerId') customerId?: string) {
    return this.receivables.outstanding({ customerId });
  }

  @Get('customers/:id/statement')
  @ApiOperation({
    summary: 'One customer’s position',
    description:
      'Their outstanding invoices, their payments, and any credit from money no invoice has claimed yet.',
  })
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.receivables.statement(id);
  }
}
