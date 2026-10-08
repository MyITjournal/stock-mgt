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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { LocationService } from './location.service';
import { SupplierService } from './supplier.service';
import { ReceivingService } from './receiving.service';
import { StockOperationsService } from './stock-operations.service';
import { StockLevelService } from './stock-level.service';
import { SyncService } from './sync.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { CreateGoodsReceiptDto } from './dto/goods-receipt.dto';
import {
  CreateAdjustmentDto,
  CreateTransferDto,
} from './dto/stock-operations.dto';
import { LocationView } from './dto/location.response';
import { SupplierView } from './dto/supplier.response';
import {
  GoodsReceiptSummary,
  CorrectionPreviewView,
  GoodsReceiptView,
} from './dto/goods-receipt.response';
import {
  ExpiringBatchRow,
  ForcedMovementView,
  MovementPageView,
  RebuildBalancesView,
  StockLevelRow,
  StockMovementView,
  TransferResultView,
} from './dto/stock.response';
import { OpeningStockService } from './opening-stock.service';
import { DeliveryCorrectionService } from './delivery-correction.service';
import { CorrectDeliveryDto } from './dto/delivery-correction.dto';
import {
  CorrectLotCostDto,
  LotCostPreviewDto,
  OpeningStockDto,
} from './dto/opening-stock.dto';
import {
  LotCostCorrectionView,
  OpeningStockProductView,
  OpeningStockResultView,
} from './dto/opening-stock.response';

/** Setting up where stock lives and who it comes from is a management job. */
const INVENTORY_EDITORS = [OrgRole.owner, OrgRole.manager];

/**
 * Taking a delivery is staff's daily work, so it stays open to them.
 * **Adjusting and moving stock is not** (owner, 2026-10-07): writing stock off
 * or moving it is a decision, and those two routes are `INVENTORY_EDITORS`
 * now. Counting stays open too — a count changes nothing until an owner or
 * manager posts it (stocktake controller).
 */
const STOCK_RECORDERS = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.storekeeper,
  OrgRole.sales_rep,
];

@ApiTags('inventory')
@ApiBearerAuth('JWT')
@Controller('locations')
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Get()
  @ApiOperation({
    summary: 'List locations',
    description:
      'Where stock physically sits: the main store, a shop counter, a van. Every organization is seeded a default.',
  })
  @ApiOkResponse({ type: [LocationView] })
  findAll() {
    return this.locations.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a location' })
  @ApiOkResponse({ type: LocationView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.findOne(id);
  }

  @Post()
  @Roles(...INVENTORY_EDITORS)
  @Idempotent(
    'A retry with the same key returns the original location instead of creating a duplicate.',
  )
  @ApiOperation({
    summary: 'Create a location',
    description:
      'Reusing the name of a previously deleted location restores that row rather than failing.',
  })
  @ApiCreatedResponse({ type: LocationView })
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Patch(':id')
  @Roles(...INVENTORY_EDITORS)
  @ApiOperation({ summary: 'Update a location' })
  @ApiOkResponse({ type: LocationView })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(id, dto);
  }

  @Delete(':id')
  @Roles(...INVENTORY_EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a location',
    description:
      'Refused while the location still holds stock — movements point at it forever, so retiring it would strand what is there.',
  })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.remove(id);
  }
}

@ApiTags('inventory')
@ApiBearerAuth('JWT')
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly suppliers: SupplierService) {}

  @Get()
  @ApiOperation({ summary: 'List suppliers' })
  @ApiOkResponse({ type: [SupplierView] })
  findAll() {
    return this.suppliers.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a supplier' })
  @ApiOkResponse({ type: SupplierView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(id);
  }

  @Post()
  @Roles(...INVENTORY_EDITORS)
  @Idempotent(
    'A retry with the same key returns the original supplier instead of creating a duplicate.',
  )
  @ApiOperation({ summary: 'Create a supplier' })
  @ApiCreatedResponse({ type: SupplierView })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliers.create(dto);
  }

  @Patch(':id')
  @Roles(...INVENTORY_EDITORS)
  @ApiOperation({ summary: 'Update a supplier' })
  @ApiOkResponse({ type: SupplierView })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  @Roles(...INVENTORY_EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a supplier',
    description: 'Soft delete: past receipts still say who they came from.',
  })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.remove(id);
  }
}

@ApiTags('inventory')
@ApiBearerAuth('JWT')
@Controller('goods-receipts')
export class GoodsReceiptController {
  constructor(
    private readonly receiving: ReceivingService,
    private readonly corrections: DeliveryCorrectionService,
  ) {}

  @Post(':id/corrections/preview')
  @Roles(...INVENTORY_EDITORS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a correction to a delivery',
    description:
      'Runs the correction and rolls it back, so it meets every check the real one does, and says how stock and the bill would move. Saves nothing.',
  })
  @ApiOkResponse({ type: CorrectionPreviewView })
  previewCorrection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectDeliveryDto,
  ): Promise<CorrectionPreviewView> {
    return this.corrections.preview(id, dto);
  }

  @Post(':id/corrections')
  @Roles(...INVENTORY_EDITORS)
  @HttpCode(HttpStatus.OK)
  @Idempotent(
    'A retry with the same key returns the original result instead of correcting twice.',
  )
  @ApiOperation({
    summary: 'Correct a recorded delivery',
    description:
      'The true figures for the lines that were entered wrong — received and paid for in base units, the invoice value in kobo — and why. The stock difference is a movement on each line’s own lot, the lot and line take the true figures, the bill moves by the change in value, and the figures before are kept as a correction record. Sales already made keep their cost. Can be done any number of times. A 409 if fewer arrived than have already been sold from the delivery (an owner or manager may force it with a reason), or if the bill would drop below what has been paid against it.',
  })
  @ApiOkResponse({ type: GoodsReceiptView })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectDeliveryDto,
  ): Promise<GoodsReceiptView> {
    return this.corrections.correct(id, dto);
  }

  @Get()
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'ISO date-time. Filters the day the delivery arrived.',
  })
  @ApiQuery({ name: 'until', required: false, description: 'ISO date-time.' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Defaults to 100, capped at 500.',
  })
  @ApiOperation({
    summary: 'List goods receipts',
    description:
      'Newest first, bounded. The date filters apply to `receivedAt` — a delivery is looked for by the day it arrived, not the day somebody got round to entering it.',
  })
  @ApiOkResponse({ type: [GoodsReceiptSummary] })
  findAll(
    @Query('supplierId') supplierId?: string,
    @Query('locationId') locationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.receiving.findAll({
      supplierId,
      locationId,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      limit,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a goods receipt',
    description:
      'Each line reports the implied `unitCost` — totalCost divided by what arrived, so free goods pull the cost of every unit down.',
  })
  @ApiOkResponse({ type: GoodsReceiptView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.receiving.findOne(id);
  }

  @Post()
  @Roles(...STOCK_RECORDERS)
  @Idempotent(
    'A retry with the same key returns the original receipt instead of receiving the delivery twice.',
  )
  @ApiOperation({
    summary: 'Receive a delivery',
    description:
      'Takes the invoice total per line, never a per-unit price — "45,211.11 x 6" loses a kobo before the calculation starts. Quantities are counted in the unit you name (the carton) and converted to base units once, here. Receiving 20 while paying for 19 is how free goods are recorded; both figures are kept. Every delivery also raises a `SupplierBill`, which is what appears on `GET /payables`.',
  })
  @ApiCreatedResponse({ type: GoodsReceiptView })
  create(@Body() dto: CreateGoodsReceiptDto) {
    return this.receiving.create(dto);
  }
}

@ApiTags('inventory')
@ApiBearerAuth('JWT')
@Controller('stock')
export class StockController {
  constructor(
    private readonly operations: StockOperationsService,
    private readonly levels: StockLevelService,
    private readonly sync: SyncService,
    private readonly opening: OpeningStockService,
  ) {}

  @Get('opening')
  @Roles(...INVENTORY_EDITORS)
  @ApiQuery({ name: 'locationId', required: false })
  @ApiOperation({
    summary: 'Products that need opening stock',
    description:
      'Every product that keeps stock and has never had stock come in at this location — the sheet an owner fills in on day one. A product sold before it was counted still appears; one that has had a delivery, a transfer in or a count surplus does not.',
  })
  @ApiOkResponse({ type: [OpeningStockProductView] })
  openingSheet(
    @Query('locationId', new ParseUUIDPipe({ optional: true }))
    locationId?: string,
  ): Promise<OpeningStockProductView[]> {
    return this.opening.list(locationId);
  }

  @Post('opening')
  @Roles(...INVENTORY_EDITORS)
  @Idempotent(
    'A retry with the same key returns the original result. A fresh key is refused with a 409, because every product on it now has stock.',
  )
  @ApiOperation({
    summary: 'Record opening stock',
    description:
      'What is on the shelves on day one and what it cost, as opening-balance adjustments: a lot each, valued at cost × quantity, with no bill raised and nothing counted toward vendor targets or the purchases report. All or nothing; a 409 if any product has had stock come in here since the sheet was opened.',
  })
  @ApiCreatedResponse({ type: OpeningStockResultView })
  recordOpening(@Body() dto: OpeningStockDto): Promise<OpeningStockResultView> {
    return this.opening.record(dto);
  }

  @Post('opening/lots/:batchId/cost/preview')
  @Roles(...INVENTORY_EDITORS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What an opening lot would be worth at a corrected cost',
    description:
      'Nothing is written. The cost is for one of the chosen unit; the lot keeps its quantity.',
  })
  @ApiOkResponse({ type: LotCostCorrectionView })
  previewLotCost(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: LotCostPreviewDto,
  ): Promise<LotCostCorrectionView> {
    return this.opening.previewCostCorrection(batchId, dto);
  }

  @Post('opening/lots/:batchId/cost')
  @Roles(...INVENTORY_EDITORS)
  @Idempotent(
    'A retry with the same key returns the original result rather than correcting twice.',
  )
  @ApiOperation({
    summary: 'Correct what an opening stock lot cost',
    description:
      'Only the value changes: the quantity and movements stay, sales already made keep their cost, and the correction is kept with its reason. A 409 for a lot that came on a delivery (correct the delivery) or is not opening stock.',
  })
  @ApiCreatedResponse({ type: LotCostCorrectionView })
  correctLotCost(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: CorrectLotCostDto,
  ): Promise<LotCostCorrectionView> {
    return this.opening.correctCost(batchId, dto);
  }

  @Get('levels')
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'includeBatches', required: false, type: Boolean })
  @ApiQuery({ name: 'includeEmpty', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Stock on hand',
    description:
      'One row per product, option and location, in base units — each option of a product is a row of its own. Ask for batches to see the lots behind the number and what each cost.',
  })
  @ApiOkResponse({ type: [StockLevelRow] })
  findLevels(
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('includeBatches', new ParseBoolPipe({ optional: true }))
    includeBatches?: boolean,
    @Query('includeEmpty', new ParseBoolPipe({ optional: true }))
    includeEmpty?: boolean,
  ) {
    return this.levels.findLevels({
      productId,
      locationId,
      includeBatches,
      includeEmpty,
    });
  }

  @Get('batches')
  @ApiQuery({
    name: 'expiringBefore',
    required: false,
    description: 'ISO date. Defaults to 30 days from now.',
  })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiOperation({
    summary: 'Batches about to expire',
    description:
      'Soonest first, with the value that walks out of the door if they are not sold in time.',
  })
  @ApiOkResponse({ type: [ExpiringBatchRow] })
  findExpiring(
    @Query('expiringBefore') expiringBefore?: string,
    @Query('locationId') locationId?: string,
  ) {
    const before = expiringBefore
      ? new Date(expiringBefore)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return this.levels.findExpiring(before, locationId);
  }

  @Get('forced')
  @Roles(...INVENTORY_EDITORS)
  @ApiQuery({ name: 'since', required: false, description: 'ISO date-time.' })
  @ApiOperation({
    summary: 'Movements recorded over a shortfall',
    description:
      'Stock that was sold or moved before it had been entered as received. The point of allowing the override is that it leaves this trail.',
  })
  @ApiOkResponse({ type: [ForcedMovementView] })
  findForced(@Query('since') since?: string) {
    return this.levels.findForced(since ? new Date(since) : undefined);
  }

  @Get('movements')
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({
    name: 'since',
    required: false,
    description:
      'ISO date-time. Syncing, this is a starting position and is ignored when a cursor is given; browsing, it is an ordinary lower bound applied alongside the cursor.',
  })
  @ApiQuery({
    name: 'until',
    required: false,
    description: 'ISO date-time. An upper bound, for browsing.',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description:
      '`asc` (the default) is the sync walk; `desc` is newest-first for a person reading the list.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The nextCursor from the previous page, passed back verbatim.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'The ledger — delta sync, or newest first',
    description:
      'Keyset paging over (createdAt, id). Syncing (`asc`), the window stops a second short of now so a transaction still committing cannot be stepped over — pages are safe to replay, since ids are client-stable. Browsing (`desc`) skips that lag: new rows arrive above wherever the reader has paged to, so a late commit is never missed, and holding it back would only hide a movement recorded a moment ago.',
  })
  @ApiOkResponse({ type: MovementPageView })
  movements(
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('order') order?: 'asc' | 'desc',
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.sync.movements({
      productId,
      locationId,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      order: order === 'desc' ? 'desc' : 'asc',
      cursor,
      limit,
    });
  }

  @Post('adjustments')
  @Roles(...INVENTORY_EDITORS)
  @Idempotent(
    'A retry with the same key returns the original movement instead of writing the stock off twice.',
  )
  @ApiOperation({
    summary: 'Adjust stock, with a reason',
    description:
      'Signed: negative writes stock off, positive brings it on. Breakage and spoilage are adjustments with a reason, never silent decrements. A negative adjustment that exceeds what is on hand is refused with a 409 naming the shortfall; an owner or manager may force it with a reason.',
  })
  @ApiCreatedResponse({
    type: [StockMovementView],
    description:
      'One movement per lot the adjustment touched — writing stock off across three lots is three rows, so the ledger still says which lot left.',
  })
  adjust(@Body() dto: CreateAdjustmentDto) {
    return this.operations.adjust(dto);
  }

  @Post('transfers')
  @Roles(...INVENTORY_EDITORS)
  @Idempotent(
    'A retry with the same key returns the original transfer instead of moving the stock twice.',
  )
  @ApiOperation({
    summary: 'Move stock between locations',
    description:
      'Writes a matched pair of movements sharing a transferGroupId. Batch identity is preserved, so the carton that arrives in the van is the same lot, with the same expiry, that left the store.',
  })
  @ApiCreatedResponse({ type: TransferResultView })
  transfer(@Body() dto: CreateTransferDto) {
    return this.operations.transfer(dto);
  }

  @Post('rebuild-balances')
  @Roles(OrgRole.owner)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rebuild cached balances from the ledger',
    description:
      'The cache is an optimisation, and one that cannot be reconstructed is a liability. Returns what it corrected; an empty list is the proof that cache and ledger agree.',
  })
  @ApiOkResponse({ type: RebuildBalancesView })
  rebuild() {
    return this.levels.rebuild();
  }
}
