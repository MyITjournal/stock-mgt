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
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { BankAccountService } from './bank-account.service';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';

/**
 * Anyone who can take money has to be able to pick the account it went into,
 * so reading is as wide as recording a payment. Setting the accounts up is the
 * owner's or manager's job — it is configuration, not a daily action.
 *
 * Note these are the accounts customers pay *into*. They are meant to be seen:
 * an invoice prints them. That is why reading them is not restricted the way
 * cost-bearing reports are.
 */
const TAKES_MONEY = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.accountant,
  OrgRole.sales_rep,
];

const SETS_UP_ACCOUNTS = [OrgRole.owner, OrgRole.manager];

@ApiTags('payments')
@ApiBearerAuth('JWT')
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private readonly accounts: BankAccountService) {}

  @Get()
  @Roles(...TAKES_MONEY)
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Include closed accounts, which are hidden by default.',
  })
  @ApiOperation({
    summary: 'List the accounts money is paid into',
    description:
      'Default first, then by sort order. A business commonly keeps several — one per bank its customers already use, and often a separate one for POS settlement.',
  })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.accounts.findAll({
      includeInactive: includeInactive === 'true',
    });
  }

  @Get(':id')
  @Roles(...TAKES_MONEY)
  @ApiOperation({ summary: 'Get a bank account' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.findOne(id);
  }

  @Post()
  @Roles(...SETS_UP_ACCOUNTS)
  @Idempotent(
    'A retry with the same key returns the original account instead of adding a duplicate.',
  )
  @ApiOperation({
    summary: 'Add an account money is paid into',
    description:
      'The account number is stored digits-only, so it can be pasted with spaces or dashes. Marking one default clears the previous default.',
  })
  create(@Body() dto: CreateBankAccountDto) {
    return this.accounts.create(dto);
  }

  @Patch(':id')
  @Roles(...SETS_UP_ACCOUNTS)
  @ApiOperation({ summary: 'Update a bank account' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.accounts.update(id, dto);
  }

  @Delete(':id')
  @Roles(...SETS_UP_ACCOUNTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a bank account',
    description:
      'Refused once payments have been banked into it — mark it inactive instead, so those payments keep saying where the money went.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.remove(id);
  }
}
