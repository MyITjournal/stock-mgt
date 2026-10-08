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
import { CashService } from './cash.service';
import {
  CreateCashBankingDto,
  VoidCashBankingDto,
} from './dto/cash-banking.dto';
import {
  BANKING_STATUSES,
  BankingStatus,
  CashBankingListView,
  CashBankingView,
  CashView,
} from './dto/cash.response';

const EVERYONE = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.accountant,
  OrgRole.sales_rep,
  OrgRole.storekeeper,
];

const CONFIRMS = [OrgRole.owner, OrgRole.manager];

@ApiTags('cash')
@ApiBearerAuth('JWT')
@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @Roles(...EVERYONE)
  @ApiOperation({
    summary: 'Whose hands the cash is in',
    description:
      'Per person: received in cash, paid out in cash, banked (confirmed), waiting to be confirmed, and still holding — with when the oldest cash still held was taken. Owner, manager and accountant see everybody; anyone else sees only themselves.',
  })
  @ApiOkResponse({ type: CashView })
  summary() {
    return this.cash.summary();
  }

  @Get('bankings')
  @Roles(...EVERYONE)
  @ApiQuery({ name: 'status', required: false, enum: BANKING_STATUSES })
  @ApiQuery({ name: 'heldByUserId', required: false })
  @ApiQuery({
    name: 'since',
    required: false,
    description:
      'ISO date-time. Syncing only: a position in the `updatedAt` walk that a cursor overrides.',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description:
      '`asc` (the default) is the sync order. `desc` is for a person reading a list, newest first. `status` applies to `desc` only — a syncing client must hear that a row it holds was confirmed.',
  })
  @ApiOperation({
    summary: 'Cash banked, paged for delta sync',
    description:
      'Keyset paging over (updatedAt, id): confirming or marking a banking not received changes the row. Staff see only their own.',
  })
  @ApiOkResponse({ type: CashBankingListView })
  findAll(
    @Query('status') status?: string,
    @Query('heldByUserId') heldByUserId?: string,
    @Query('since') since?: string,
    @Query('order') order?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.cash.findAll({
      status: BANKING_STATUSES.includes(status as BankingStatus)
        ? (status as BankingStatus)
        : undefined,
      heldByUserId,
      since: since ? new Date(since) : undefined,
      order: order === 'desc' ? 'desc' : undefined,
      cursor,
      limit,
    });
  }

  @Get('bankings/:id')
  @Roles(...EVERYONE)
  @ApiOperation({ summary: 'One banking' })
  @ApiOkResponse({ type: CashBankingView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.cash.findOne(id);
  }

  @Post('bankings')
  @Roles(...EVERYONE)
  @Idempotent(
    'A retry with the same key returns the original banking instead of recording it twice.',
  )
  @ApiOperation({
    summary: 'Record cash banked, or handed to the owner',
    description:
      'Neither a payment nor an expense: it changes no invoice, bill or profit figure. Staff record only their own; an owner or manager records for anyone, and theirs is confirmed as it is recorded (the owner’s own too). Anyone else’s waits for the owner or a manager to confirm.',
  })
  @ApiCreatedResponse({ type: CashBankingView })
  @ApiConflictResponse({
    description:
      '`error: MORE_THAN_HELD` — more than the person holds. A shortfall is fine: bank what you have and the rest stays as still holding.',
  })
  create(@Body() dto: CreateCashBankingDto) {
    return this.cash.create(dto);
  }

  @Post('bankings/:id/confirm')
  @Roles(...CONFIRMS)
  @ApiOperation({
    summary: 'Confirm the money arrived',
    description: 'Owner or manager. Nobody confirms their own banking.',
  })
  @ApiCreatedResponse({ type: CashBankingView })
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.cash.confirm(id);
  }

  @Post('bankings/:id/void')
  @Roles(...CONFIRMS)
  @ApiOperation({
    summary: 'Mark a banking not received',
    description:
      'Owner or manager, with a reason. The amount goes back to the person’s still holding; the row is kept.',
  })
  @ApiCreatedResponse({ type: CashBankingView })
  voidBanking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidCashBankingDto,
  ) {
    return this.cash.voidBanking(id, dto);
  }
}
