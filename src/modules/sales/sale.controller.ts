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
import { SaleService } from './sale.service';
import { SaleReturnService } from './sale-return.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CreateReturnDto } from './dto/create-return.dto';

/** Selling is the sales rep's daily work, and the storekeeper counters too. */
const SELLERS = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.sales_rep,
  OrgRole.storekeeper,
];

@ApiTags('sales')
@ApiBearerAuth('JWT')
@Controller('sales')
export class SaleController {
  constructor(
    private readonly sales: SaleService,
    private readonly returns: SaleReturnService,
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
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'List sales, paged for delta sync',
    description:
      'Keyset paging over (createdAt, id), the same shape the stock ledger uses. The window stops a second short of now so a sale still committing cannot be stepped over.',
  })
  findAll(
    @Query('customerId') customerId?: string,
    @Query('locationId') locationId?: string,
    @Query('since') since?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.sales.findAll({
      customerId,
      locationId,
      since: since ? new Date(since) : undefined,
      cursor,
      limit,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a sale',
    description:
      'With its lines, anything returned against it, and the derived balance still owed.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(id);
  }

  @Get(':id/receipt')
  @ApiOperation({
    summary: 'The printable receipt for a sale',
    description:
      'A deliberately narrow payload: what the customer is handed, and nothing else. Kept separate from the sale itself so the shape a printer depends on does not shift every time the sale model grows.',
  })
  receipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.receipt(id);
  }

  @Post()
  @Roles(...SELLERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Send a unique key per sale. A retry with the same key returns the original sale instead of selling the goods twice.',
  })
  @ApiOperation({
    summary: 'Record a sale',
    description:
      'Prices each line from the customer’s tier unless the seller names the price agreed, and takes the stock through the ledger — FEFO, so the batch that expires first leaves first. A sale the stock cannot cover is refused with a 409 naming the shortfall; an owner or manager may force it with a reason.',
  })
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Post(':id/returns')
  @Roles(...SELLERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'A retry with the same key returns the original outcome instead of restocking the goods twice.',
  })
  @ApiOperation({
    summary: 'Take goods back',
    description:
      'Refunds a share of what was actually charged and puts the stock back into the lot it came from, so a returned carton keeps its expiry date. Goods that came back broken are refunded with `restocked: false` and never re-enter sellable stock.',
  })
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReturnDto,
  ) {
    return this.returns.create(id, dto);
  }
}
