import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { StocktakeService } from './stocktake.service';
import { CountLinesDto, CreateStocktakeDto } from './dto/stocktake.dto';
import {
  PostedStocktakeView,
  StocktakeSummary,
  StocktakeView,
} from './dto/stocktake.response';

/** Walking the aisles with a phone is the storekeeper's job, and the rep's. */
const COUNTERS = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.storekeeper,
  OrgRole.sales_rep,
];

/**
 * Deciding a variance is real is not the same job as finding it.
 *
 * Posting rewrites stock, and a counter who can both report a shortfall and
 * approve it can walk out with the difference. The split is the point of having
 * two steps at all — the same reasoning as the forced-movement override in §5.
 */
const POSTERS = [OrgRole.owner, OrgRole.manager];

@ApiTags('inventory')
@ApiBearerAuth('JWT')
@Controller('stocktakes')
export class StocktakeController {
  constructor(private readonly stocktakes: StocktakeService) {}

  @Get()
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'posted', 'cancelled'],
  })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiOperation({ summary: 'List stocktakes, newest first' })
  @ApiOkResponse({ type: [StocktakeSummary] })
  findAll(
    @Query('status') status?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.stocktakes.findAll({ status, locationId });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One count, with the variance on each line',
    description:
      'While a count is open the variance is measured against live stock, because that is what posting will compare. Once posted it reports the snapshot, which is what was actually true when the correction was made.',
  })
  @ApiOkResponse({ type: StocktakeView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stocktakes.findOne(id);
  }

  @Post()
  @Roles(...COUNTERS)
  @Idempotent(
    'A retry with the same key returns the original count instead of opening a second one.',
  )
  @ApiOperation({
    summary: 'Open a count',
    description:
      'One open count per location at a time: two would post variances against each other’s corrections.',
  })
  @ApiCreatedResponse({ type: StocktakeSummary })
  create(@Body() dto: CreateStocktakeDto) {
    return this.stocktakes.create(dto);
  }

  @Post(':id/lines')
  @Roles(...COUNTERS)
  @ApiOperation({
    summary: 'Record what was counted',
    description:
      'Takes the whole sheet at once, in base units. Counting a product twice replaces the earlier line — a recount is a correction, not a second opinion. Nothing here touches stock.',
  })
  @ApiCreatedResponse({ type: StocktakeView })
  count(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CountLinesDto) {
    return this.stocktakes.count(id, dto);
  }

  @Delete(':id/lines/:productId')
  @Roles(...COUNTERS)
  @ApiOperation({ summary: 'Remove a line counted by mistake' })
  @ApiOkResponse({ type: StocktakeView })
  removeLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.stocktakes.removeLine(id, productId);
  }

  @Post(':id/post')
  @Roles(...POSTERS)
  @Idempotent(
    'A retry with the same key returns the original outcome instead of posting the corrections twice. Use a fresh key for every count: this route takes no body, so a key reused across two stocktakes matches the first one and silently posts nothing.',
  )
  @ApiOperation({
    summary: 'Post the count, writing the corrections to the ledger',
    description:
      'Owner or manager only — finding a shortfall and approving it are deliberately different jobs. Variances are recomputed against live stock, then written as `adjustment` movements with reason `count_correction`: shortfalls leave FEFO, surpluses land on the most recently received batch at that location.',
  })
  @ApiCreatedResponse({ type: PostedStocktakeView })
  post(@Param('id', ParseUUIDPipe) id: string) {
    return this.stocktakes.post(id);
  }

  @Post(':id/cancel')
  @Roles(...POSTERS)
  @ApiOperation({
    summary: 'Abandon a count',
    description:
      'The lines are kept for the record; nothing reaches the ledger.',
  })
  @ApiCreatedResponse({ type: StocktakeView })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.stocktakes.cancel(id);
  }
}
