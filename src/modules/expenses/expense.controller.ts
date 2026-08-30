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
import { ExpenseService } from './expense.service';
import { ExpenseCategoryService } from './expense-category.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-category.dto';

/** Spending money, and saying what it was for. */
const SPENDERS = [OrgRole.owner, OrgRole.manager, OrgRole.accountant];

@ApiTags('expenses')
@ApiBearerAuth('JWT')
@Controller('expenses')
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get()
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date-time.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date-time.' })
  @ApiOperation({
    summary: 'List expenses',
    description:
      'Newest first, with the period total and a breakdown per category — the shape "what did I spend on transport last month" needs.',
  })
  findAll(
    @Query('categoryId') categoryId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expenses.findAll({
      categoryId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an expense' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.findOne(id);
  }

  @Post()
  @Roles(...SPENDERS)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Record an expense' })
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }

  @Patch(':id')
  @Roles(...SPENDERS)
  @ApiOperation({ summary: 'Update an expense' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(id, dto);
  }

  @Delete(':id')
  @Roles(...SPENDERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an expense',
    description:
      'Soft, so a corrected month still explains what it used to say.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.remove(id);
  }
}

@ApiTags('expenses')
@ApiBearerAuth('JWT')
@Controller('expense-categories')
export class ExpenseCategoryController {
  constructor(private readonly categories: ExpenseCategoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List expense categories',
    description:
      'Every organization is seeded with the usual ones at registration; the list is meant to be edited.',
  })
  findAll() {
    return this.categories.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an expense category' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @Roles(...SPENDERS)
  @ApiOperation({
    summary: 'Create an expense category',
    description:
      'Recreating one that was deleted revives the original row rather than colliding with it.',
  })
  create(@Body() dto: CreateExpenseCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @Roles(...SPENDERS)
  @ApiOperation({ summary: 'Update an expense category' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @Roles(...SPENDERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an expense category',
    description: 'Soft: past expenses keep reporting under the name they had.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }
}
