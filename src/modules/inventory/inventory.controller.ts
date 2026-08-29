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

/** Setting up where stock lives and who it comes from is a management job. */
const INVENTORY_EDITORS = [OrgRole.owner, OrgRole.manager];

/** Recording stock movements is the storekeeper's daily work. */
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
  findAll() {
    return this.locations.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a location' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.findOne(id);
  }

  @Post()
  @Roles(...INVENTORY_EDITORS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original location instead of creating a duplicate.',
  })
  @ApiOperation({
    summary: 'Create a location',
    description:
      'Reusing the name of a previously deleted location restores that row rather than failing.',
  })
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Patch(':id')
  @Roles(...INVENTORY_EDITORS)
  @ApiOperation({ summary: 'Update a location' })
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
  findAll() {
    return this.suppliers.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a supplier' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(id);
  }

  @Post()
  @Roles(...INVENTORY_EDITORS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original supplier instead of creating a duplicate.',
  })
  @ApiOperation({ summary: 'Create a supplier' })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliers.create(dto);
  }

  @Patch(':id')
  @Roles(...INVENTORY_EDITORS)
  @ApiOperation({ summary: 'Update a supplier' })
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
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.remove(id);
  }
}

@ApiTags('inventory')
@ApiBearerAuth('JWT')
@Controller('goods-receipts')
export class GoodsReceiptController {
  constructor(private readonly receiving: ReceivingService) {}

  @Get()
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiOperation({ summary: 'List goods receipts' })
  findAll(
    @Query('supplierId') supplierId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.receiving.findAll({ supplierId, locationId });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a goods receipt',
    description:
      'Each line reports the implied `unitCost` — totalCost divided by what arrived, so free goods pull the cost of every unit down.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.receiving.findOne(id);
  }

  @Post()
  @Roles(...STOCK_RECORDERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original receipt instead of receiving the delivery twice.',
  })
  @ApiOperation({
    summary: 'Receive a delivery',
    description:
      'Takes the invoice total per line, never a per-unit price — "45,211.11 x 6" loses a kobo before the calculation starts. Quantities are counted in the unit you name (the carton) and converted to base units once, here. Receiving 20 while paying for 19 is how free goods are recorded; both figures are kept.',
  })
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
  ) {}

  @Get('levels')
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'includeBatches', required: false, type: Boolean })
  @ApiQuery({ name: 'includeEmpty', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Stock on hand',
    description:
      'One row per product and location, in base units. Ask for batches to see the lots behind the number and what each cost.',
  })
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
  findForced(@Query('since') since?: string) {
    return this.levels.findForced(since ? new Date(since) : undefined);
  }

  @Get('movements')
  @ApiQuery({ name: 'productId', required: false })
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
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'The ledger, for delta sync',
    description:
      'Keyset paging over (createdAt, id). The window stops a second short of now so a transaction still committing cannot be stepped over — pages are safe to replay, since ids are client-stable.',
  })
  movements(
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('since') since?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.sync.movements({
      productId,
      locationId,
      since: since ? new Date(since) : undefined,
      cursor,
      limit,
    });
  }

  @Post('adjustments')
  @Roles(...STOCK_RECORDERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original movement instead of writing the stock off twice.',
  })
  @ApiOperation({
    summary: 'Adjust stock, with a reason',
    description:
      'Signed: negative writes stock off, positive brings it on. Breakage and spoilage are adjustments with a reason, never silent decrements. A negative adjustment that exceeds what is on hand is refused with a 409 naming the shortfall; an owner or manager may force it with a reason.',
  })
  adjust(@Body() dto: CreateAdjustmentDto) {
    return this.operations.adjust(dto);
  }

  @Post('transfers')
  @Roles(...STOCK_RECORDERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original transfer instead of moving the stock twice.',
  })
  @ApiOperation({
    summary: 'Move stock between locations',
    description:
      'Writes a matched pair of movements sharing a transferGroupId. Batch identity is preserved, so the carton that arrives in the van is the same lot, with the same expiry, that left the store.',
  })
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
  rebuild() {
    return this.levels.rebuild();
  }
}
