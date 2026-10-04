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
 * A quota the owner negotiated with a vendor is a management figure — what the
 * shop has committed to buy — so it follows the rule for the buying side in
 * §12: a `sales_rep` does not see it. The dashboard shows progress against it
 * too, which is safe because that endpoint has the same roles.
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
      'In cartons, where each product’s carton is its biggest unit — a carton of 12 and a carton of 24 each count as one. Progress counts goods **received**, not orders placed, and only what was **paid for**: "buy 19, get 1 free" advances a target by 19. Products in the category with no carton are listed in `productsWithoutCarton` rather than skipped.',
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
      'A category and a number of cartons — "112 cartons of lotion". Any product filed under the category counts. `period` is any instant inside the target month and is snapped to the first of it in the organization’s timezone — vendor schemes run on calendar months.',
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
      'Only the number of cartons and the note. The vendor, category and month are what the target is — changing them would silently restate what a past month meant — so they are refused; remove it and set the one you mean.',
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
