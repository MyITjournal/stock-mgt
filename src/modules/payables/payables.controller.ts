import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
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
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { PayableService } from './payable.service';
import { SupplierBillService } from './supplier-bill.service';
import { SupplierPaymentService } from './supplier-payment.service';
import {
  CreateSupplierBillDto,
  UpdateSupplierBillDto,
} from './dto/supplier-bill.dto';
import {
  CreateSupplierPaymentDto,
  VoidSupplierPaymentDto,
} from './dto/supplier-payment.dto';
import {
  PayablesView,
  SupplierBillView,
  SupplierPaymentListView,
  SupplierPaymentView,
  SupplierStatementView,
} from './dto/payables.response';

/**
 * Everything here is a buying price.
 *
 * What the business owes its vendors, and what it paid them, is the same
 * commercial secret as what the goods cost — §9's cost-visibility rule applies
 * to all of it. A rep must never reach these routes, so the role list is the
 * same three, spelled out here rather than imported from `SEES_COST` because
 * this is an authorisation decision about money out, not a redaction of cost
 * fields on a row somebody is otherwise entitled to.
 */
const HANDLES_PAYABLES = [OrgRole.owner, OrgRole.manager, OrgRole.accountant];

@ApiTags('payables')
@ApiBearerAuth('JWT')
@Controller()
@Roles(...HANDLES_PAYABLES)
export class PayablesController {
  constructor(
    private readonly payables: PayableService,
    private readonly bills: SupplierBillService,
    private readonly payments: SupplierPaymentService,
  ) {}

  @Get('payables')
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiOperation({
    summary: 'What I owe',
    description:
      'Every vendor bill with money still on it, longest outstanding first, with a total per vendor. `total` is the headline figure for the dashboard; the list behind it is what a click opens. A list rather than 30/60/90 buckets — the question is who has been owed longest, which is a sort.',
  })
  @ApiOkResponse({ type: PayablesView })
  outstanding(@Query('supplierId') supplierId?: string) {
    return this.payables.outstanding({ supplierId });
  }

  @Get('suppliers/:id/statement')
  @ApiOperation({
    summary: 'One vendor’s position',
    description:
      'Their unsettled bills and every payment made to them. What you read out when they ring to chase.',
  })
  @ApiOkResponse({ type: SupplierStatementView })
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.payables.statement(id);
  }

  // -- Bills ----------------------------------------------------------------

  @Get('supplier-bills')
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({
    name: 'unsettledOnly',
    required: false,
    type: Boolean,
    description: 'Only bills with money still on them.',
  })
  @ApiOperation({
    summary: 'List vendor bills, settled ones included',
    description:
      'Unlike `GET /payables`, this keeps bills that are fully paid — it is the record of what was owed and when it was cleared.',
  })
  @ApiOkResponse({ type: [SupplierBillView] })
  listBills(
    @Query('supplierId') supplierId?: string,
    @Query('unsettledOnly', new ParseBoolPipe({ optional: true }))
    unsettledOnly?: boolean,
  ) {
    return this.bills.findAll({ supplierId, unsettledOnly });
  }

  @Get('supplier-bills/:id')
  @ApiOperation({ summary: 'Get a vendor bill with what has been paid on it' })
  @ApiOkResponse({ type: SupplierBillView })
  findBill(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.findOne(id);
  }

  @Post('supplier-bills')
  @Idempotent(
    'A retry with the same key returns the original bill instead of recording the debt twice.',
  )
  @ApiOperation({
    summary: 'Record money already owed to a vendor',
    description:
      'For opening balances — what was owed on the day you started using this system. **This creates no stock.** The goods behind it arrived, and probably sold, long before; inventing movements for them would put inventory in the ledger that is not on the shelf. A delivery recorded through `POST /goods-receipts` raises its own bill and does move stock.',
  })
  @ApiCreatedResponse({ type: SupplierBillView })
  createBill(@Body() dto: CreateSupplierBillDto) {
    return this.bills.create(dto);
  }

  @Patch('supplier-bills/:id')
  @ApiOperation({
    summary: 'Correct a vendor bill',
    description:
      'Chiefly `amountDue`, when the invoice turns out to carry a delivery charge or a discount that no stock line could hold. Cannot be reduced below what has already been paid against it.',
  })
  @ApiOkResponse({ type: SupplierBillView })
  updateBill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierBillDto,
  ) {
    return this.bills.update(id, dto);
  }

  @Delete('supplier-bills/:id')
  @ApiOperation({
    summary: 'Remove a bill that should never have been entered',
    description:
      'Refused once payments exist against it — void those first, or the money would be left answering a debt that no longer exists.',
  })
  removeBill(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.remove(id);
  }

  // -- Payments -------------------------------------------------------------

  @Get('supplier-payments')
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'billId', required: false })
  @ApiQuery({ name: 'since', required: false, description: 'ISO date-time.' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'List payments made to vendors, paged for delta sync',
    description:
      'Keyset paging over `(updatedAt, id)` — a payment is mutable, because voiding one has to reach a client that already synced it. Clients upsert by id, since that ordering can re-send a row.',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description:
      '`asc` (the default) is the sync order. `desc` is for a person reading a list, newest first, and skips the one-second sync lag.',
  })
  @ApiOkResponse({ type: SupplierPaymentListView })
  listPayments(
    @Query('supplierId') supplierId?: string,
    @Query('billId') billId?: string,
    @Query('order') order?: string,
    @Query('since') since?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.payments.findAll({
      supplierId,
      billId,
      order: order === 'desc' ? 'desc' : undefined,
      since: since ? new Date(since) : undefined,
      cursor,
      limit,
    });
  }

  @Get('supplier-payments/:id')
  @ApiOperation({ summary: 'Get a payment made to a vendor' })
  @ApiOkResponse({ type: SupplierPaymentView })
  findPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(id);
  }

  @Post('supplier-payments')
  @Idempotent(
    'A retry with the same key returns the original payment instead of paying the vendor twice.',
  )
  @ApiOperation({
    summary: 'Pay a vendor',
    description:
      'Settles exactly one bill, in whole or in part. Paying more than is outstanding is a 409 — correct the bill’s `amountDue` if the invoice was higher than entered. `transfer` and `pos` must name the account the money left from; `cash` must not.',
  })
  @ApiCreatedResponse({ type: SupplierPaymentView })
  createPayment(@Body() dto: CreateSupplierPaymentDto) {
    return this.payments.create(dto);
  }

  @Post('supplier-payments/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Void a payment that should never have been recorded',
    description:
      'Says the money never moved — a mis-key, the wrong vendor. The row is kept and stops counting, so the bill goes back to owing. A reason is required.',
  })
  @ApiOkResponse({ type: SupplierPaymentView })
  voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidSupplierPaymentDto,
  ) {
    return this.payments.void(id, dto);
  }
}
