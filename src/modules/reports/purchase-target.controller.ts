import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { PurchaseTargetService } from './purchase-target.service';
import {
  CreatePurchaseTargetDto,
  PurchaseTargetQueryDto,
  UpdatePurchaseTargetDto,
} from './dto/purchase-target.dto';
import {
  PurchaseTargetReportView,
  PurchaseTargetView,
} from './dto/purchase-target.response';

/**
 * A quota the owner negotiated is a management figure, and `targetValue` is a
 * buying price in all but name — so this follows the same rule as profit and
 * valuation in §12: a `sales_rep` does not see it.
 *
 * It is also why targets are not on `GET /reports/dashboard`, which reps do
 * see: one payload cannot have two audiences without stripping fields per role,
 * and a field stripped by mistake leaks buying prices into a market.
 */
const SEES_TARGETS = [OrgRole.owner, OrgRole.manager, OrgRole.accountant];

/** Setting the quota is the owner's or the manager's call, not the bookkeeper's. */
const SETS_TARGETS = [OrgRole.owner, OrgRole.manager];

@ApiTags('reports')
@ApiBearerAuth('JWT')
@Controller('purchase-targets')
export class PurchaseTargetController {
  constructor(private readonly targets: PurchaseTargetService) {}

  @Get()
  @Roles(...SEES_TARGETS)
  @ApiOperation({
    summary: 'List vendor purchase targets',
    description: 'Newest month first. Filter by `supplierId`.',
  })
  @ApiOkResponse({ type: [PurchaseTargetView] })
  findAll(@Query() query: PurchaseTargetQueryDto) {
    return this.targets.findAll(query);
  }

  @Get('report')
  @Roles(...SEES_TARGETS)
  @ApiOperation({
    summary: 'Target, achieved and remaining for a month',
    description:
      'Progress counts goods **received**, not orders placed: an order the vendor has not delivered is what still needs chasing, so it stays in "remaining". Quantities come from `quantityPaidFor`, so "buy 19, get 1 free" advances a 110-case target by 19 — the free case is real stock and counts for valuation, just not against the quota. Value comes from the invoice totals. A category target counts only the products in it that carry no target of their own, or the same carton would advance both rows.',
  })
  @ApiOkResponse({ type: PurchaseTargetReportView })
  report(@Query() query: PurchaseTargetQueryDto) {
    return this.targets.report(query);
  }

  @Get(':id')
  @Roles(...SEES_TARGETS)
  @ApiOperation({ summary: 'Get a purchase target' })
  @ApiOkResponse({ type: PurchaseTargetView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.targets.findOne(id);
  }

  @Post()
  @Roles(...SETS_TARGETS)
  @Idempotent(
    'A retry with the same key returns the original target instead of setting a second one.',
  )
  @ApiOperation({
    summary: 'Set a vendor purchase target',
    description:
      'Against exactly one of a category or a product. `period` is any instant inside the target month and is snapped to the first of it in the organization’s timezone — vendor schemes run on calendar months. Quote the quantity in `unitId` ("110 cartons") and it is converted to base units with the factor as it stands now.',
  })
  @ApiCreatedResponse({ type: PurchaseTargetView })
  create(@Body() dto: CreatePurchaseTargetDto) {
    return this.targets.create(dto);
  }

  @Patch(':id')
  @Roles(...SETS_TARGETS)
  @ApiOperation({
    summary: 'Update a purchase target',
    description:
      'What a target is set against cannot change — rewriting a lotions target into a roll-on one would silently restate what last month meant. Delete it and set the one you mean.',
  })
  @ApiOkResponse({ type: PurchaseTargetView })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseTargetDto,
  ) {
    return this.targets.update(id, dto);
  }

  @Delete(':id')
  @Roles(...SETS_TARGETS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a purchase target',
    description:
      'Soft, so a month already reported on keeps explaining itself.',
  })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.targets.remove(id);
  }
}
