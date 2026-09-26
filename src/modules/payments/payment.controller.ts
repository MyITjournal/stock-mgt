import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole, PaymentMethod } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { PaymentService } from './payment.service';
import { ReceivableService } from './receivable.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { ReceivablesView, StatementView } from './dto/receivable.response';
import { PaymentListView, PaymentView } from './dto/payment.response';

/**
 * Taking money is the counter's job and the rep's on the route; reconciling it
 * is the accountant's. This is the first slice where that role does anything.
 *
 * The reads carry the same list. A rep genuinely needs the payment feed — an
 * offline client computes an invoice's balance from the payments and returns it
 * has synced, so closing it would break sync rather than tighten anything — but
 * a storekeeper has no business in it, and the endpoints were open to every
 * member including them.
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
  @Roles(...MONEY_HANDLERS)
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({
    name: 'since',
    required: false,
    description:
      'ISO date-time. Syncing, a position in the `updatedAt` walk that a cursor overrides; browsing, a lower bound on `occurredAt` — when the money moved.',
  })
  @ApiQuery({
    name: 'until',
    required: false,
    description: 'ISO date-time. An upper bound on `occurredAt`, for browsing.',
  })
  @ApiQuery({
    name: 'method',
    required: false,
    enum: PaymentMethod,
    description: 'One method — the reconciliation question.',
  })
  @ApiQuery({
    name: 'includeVoided',
    required: false,
    type: Boolean,
    description:
      'Defaults to true: voided payments belong on this feed, which is the audit trail. Pass false to hide them while reconciling. **Browsing only** — a syncing client must always be told about a void, which is why this feed walks `updatedAt` at all.',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'List payments, paged for delta sync',
    description:
      'Keyset paging over (updatedAt, id) — payments are mutable, because a void must reach a client that already synced the row. Two readers, one endpoint: a syncing client walks forward with the default `asc`, and a person browsing walks backward from today with `order=desc`.',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description:
      '`asc` (the default) is the sync order. `desc` is for a person reading a list, newest first, and skips the one-second sync lag.',
  })
  @ApiOkResponse({ type: PaymentListView })
  findAll(
    @Query('customerId') customerId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('method') method?: PaymentMethod,
    @Query('includeVoided', new ParseBoolPipe({ optional: true }))
    includeVoided?: boolean,
    @Query('order') order?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.payments.findAll({
      customerId,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      method,
      includeVoided,
      order: order === 'desc' ? 'desc' : undefined,
      cursor,
      limit,
    });
  }

  @Get(':id')
  @Roles(...MONEY_HANDLERS)
  @ApiOperation({
    summary: 'Get a payment',
    description: 'With what it settled, and anything left over as credit.',
  })
  @ApiOkResponse({ type: PaymentView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(id);
  }

  @Post()
  @Roles(...MONEY_HANDLERS)
  @Idempotent(
    'A retry with the same key returns the original payment instead of banking it twice.',
  )
  @ApiOperation({
    summary: 'Record a payment',
    description:
      'One row per thing that happened: a single transfer settling three invoices is one payment with three allocations, so it still matches the bank statement. Omit `allocations` to settle the oldest invoices first; anything not allocated stays as credit on the customer. A negative amount is money handed back.',
  })
  @ApiCreatedResponse({ type: PaymentView })
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
  @ApiCreatedResponse({ type: PaymentView })
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
  @Roles(...MONEY_HANDLERS)
  @ApiQuery({ name: 'customerId', required: false })
  @ApiOperation({
    summary: 'Who owes me',
    description:
      'Every invoice with money still on it, longest outstanding first, with a total per customer. A list rather than 30/60/90 buckets — the question people actually ask is who has owed longest.',
  })
  @ApiOkResponse({ type: ReceivablesView })
  outstanding(@Query('customerId') customerId?: string) {
    return this.receivables.outstanding({ customerId });
  }

  @Get('customers/:id/statement')
  @Roles(...MONEY_HANDLERS)
  @ApiOperation({
    summary: 'One customer’s position',
    description:
      'Their outstanding invoices, their payments, and any credit from money no invoice has claimed yet.',
  })
  @ApiOkResponse({ type: StatementView })
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.receivables.statement(id);
  }
}
