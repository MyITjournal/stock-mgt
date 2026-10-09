import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { SaleService } from './sale.service';
import { SaleReturnService } from './sale-return.service';
import { SaleCorrectionService } from './sale-correction.service';
import { DueService } from './due.service';
import { DueInvoicesView } from './dto/due.response';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { CorrectSaleDto } from './dto/correct-sale.dto';
import {
  PossibleDuplicateConflict,
  SaleCorrectionPreviewView,
  SaleListView,
  SaleReceiptView,
  SaleView,
} from './dto/sale.response';

/** Selling is the sales rep's daily work, and the storekeeper counters too. */
const SELLERS = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.sales_rep,
  OrgRole.storekeeper,
];

/**
 * **Taking goods back is not** (owner, 2026-10-07): a return pays money out of
 * the till and puts goods back on the shelf, so a made-up return is a way to
 * walk off with either. Owner or manager only — the same people who may force
 * a sale through a shortfall.
 */
const TAKES_BACK = [OrgRole.owner, OrgRole.manager];

@ApiTags('sales')
@ApiBearerAuth('JWT')
@Controller('sales')
export class SaleController {
  constructor(
    private readonly sales: SaleService,
    private readonly returns: SaleReturnService,
    private readonly corrections: SaleCorrectionService,
    private readonly due: DueService,
  ) {}

  @Get()
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'ISO date-time. Ignored when a cursor is given.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The nextCursor from the previous page, passed back verbatim.',
  })
  @ApiQuery({
    name: 'until',
    required: false,
    description:
      'ISO date-time upper bound. Browsing only — a sync has no reason to stop early.',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description:
      '`asc` (the default) is the sync order. `desc` is for a person reading a list, newest first.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'List sales, for delta sync or for reading',
    description:
      'Keyset paging over (createdAt, id), the same shape the stock ledger uses. The window stops a second short of now so a sale still committing cannot be stepped over. Two readers, one endpoint: a syncing client walks forward from where it stopped, and a person browsing walks backward from today with `order=desc` and a date range.',
  })
  @ApiOkResponse({ type: SaleListView })
  findAll(
    @Query('customerId') customerId?: string,
    @Query('locationId') locationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('order') order?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.sales.findAll({
      customerId,
      locationId,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      order: order === 'desc' ? 'desc' : undefined,
      cursor,
      limit,
    });
  }

  // Declared before ':id', which would otherwise take "due" for an id.
  @Get('due')
  @ApiOperation({
    summary: 'Payments due',
    description:
      'Credit sales still owing whose due day — five days after the sale — is past, today, or within the next two days, oldest first, with days past due in the shop’s timezone. Open to every member of staff: it is who to ask, not what anything cost.',
  })
  @ApiOkResponse({ type: DueInvoicesView })
  dueInvoices(): Promise<DueInvoicesView> {
    return this.due.list();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a sale',
    description:
      'With its lines, anything returned against it, and the derived balance still owed.',
  })
  @ApiOkResponse({ type: SaleView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(id);
  }

  @Get(':id/receipt')
  @ApiOperation({
    summary: 'The printable receipt for a sale',
    description:
      'A deliberately narrow payload: what the customer is handed, and nothing else. Kept separate from the sale itself so the shape a printer depends on does not shift every time the sale model grows.',
  })
  @ApiOkResponse({ type: SaleReceiptView })
  receipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.receipt(id);
  }

  @Post()
  @Roles(...SELLERS)
  @Idempotent(
    'Send a unique key per sale. A retry with the same key returns the original sale instead of selling the goods twice.',
  )
  @ApiOperation({
    summary: 'Record a sale',
    description:
      'Prices each line from the customer’s tier unless the seller names the price agreed, and takes the stock through the ledger — FEFO, so the batch that expires first leaves first. A sale the stock cannot cover is refused with a 409 naming the shortfall; an owner or manager may force it with a reason.',
  })
  @ApiCreatedResponse({ type: SaleView })
  @ApiConflictResponse({
    type: PossibleDuplicateConflict,
    description:
      'Not enough stock, a customer who still owes, or — with `error: POSSIBLE_DUPLICATE` — a sale that looks already recorded.',
  })
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Post(':id/returns')
  @Roles(...TAKES_BACK)
  @Idempotent(
    'A retry with the same key returns the original outcome instead of restocking the goods twice.',
  )
  @ApiOperation({
    summary: 'Take goods back',
    description:
      'Refunds a share of what was actually charged and puts the stock back into the lot it came from, so a returned carton keeps its expiry date. Goods that came back broken are refunded with `restocked: false` and never re-enter sellable stock.',
  })
  @ApiCreatedResponse({ type: SaleView })
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReturnDto,
  ) {
    return this.returns.create(id, dto);
  }

  @Post(':id/corrections/preview')
  @Roles(...TAKES_BACK)
  @ApiOperation({
    summary: 'Preview a correction to a sale',
    description:
      'Runs the correction and rolls it back, so it meets every check the real one does, and says what the total, the payments and the balance would become. Saves nothing.',
  })
  @ApiOkResponse({ type: SaleCorrectionPreviewView })
  previewCorrection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectSaleDto,
  ): Promise<SaleCorrectionPreviewView> {
    return this.corrections.preview(id, dto);
  }

  /**
   * Owner or manager, like taking goods back: lowering a price after the fact
   * is money, and a rep who could do it could pocket the difference.
   */
  @Post(':id/corrections')
  @Roles(...TAKES_BACK)
  @Idempotent(
    'Send the correction’s own id too: across a retry the id is what makes two attempts one correction.',
  )
  @ApiOperation({
    summary: 'Correct a sale',
    description:
      'The prices really charged (per line, tax-inclusive, as the till takes them), the customer it really was, or both, and why. The sale and its lines take the true figures, so every report reads them. A payment that would be more than the new total is voided and one for the true amount recorded in its place, by the same person on the same day; on a sale that was paid in full, a higher total raises the payment the same way, so it stays paid in full. One on credit or part-paid owes the difference instead. Payments that settled only this sale move with it to the right customer. Stock and cost do not move. A 409 when goods have come back on the sale (prices only), when no single payment can be brought down to the new total, when a payment on it also paid other invoices (customer only), or when it would leave a walk-in sale owing — a walk-in cannot buy on credit.',
  })
  @ApiCreatedResponse({ type: SaleView })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectSaleDto,
  ): Promise<SaleView> {
    return this.corrections.correct(id, dto);
  }
}
