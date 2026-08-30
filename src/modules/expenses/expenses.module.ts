import { Module } from '@nestjs/common';
import {
  ExpenseCategoryController,
  ExpenseController,
} from './expense.controller';
import { ExpenseService } from './expense.service';
import { ExpenseCategoryService } from './expense-category.service';

/**
 * Money out that is not the cost of goods, so the profit view has both halves
 * of its subtraction.
 */
@Module({
  controllers: [ExpenseController, ExpenseCategoryController],
  providers: [ExpenseService, ExpenseCategoryService],
  exports: [ExpenseService, ExpenseCategoryService],
})
export class ExpensesModule {}
