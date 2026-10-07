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
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CustomerMergeView, CustomerView } from './dto/customer.response';
import {
  CreateCustomerDto,
  MergeCustomerDto,
  UpdateCustomerDto,
} from './dto/create-customer.dto';

@ApiTags('customers')
@ApiBearerAuth('JWT')
@Controller('customers')
export class CustomerController {
  constructor(private readonly svc: CustomerService) {}

  @Get()
  @ApiOperation({ summary: 'List customers' })
  @ApiOkResponse({ type: [CustomerView] })
  findAll() {
    return this.svc.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer' })
  @ApiOkResponse({ type: CustomerView })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a customer' })
  @ApiCreatedResponse({ type: CustomerView })
  create(@Body() dto: CreateCustomerDto) {
    return this.svc.create(dto);
  }

  @Delete(':id')
  @Roles(OrgRole.owner, OrgRole.manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a customer with no invoices or payments',
    description:
      'For one added by mistake. A customer with history is a 409: their invoices are what the business is owed, and a duplicate is merged instead, which moves that history to the customer kept.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.svc.remove(id);
  }

  @Post(':id/merge')
  @Roles(OrgRole.owner, OrgRole.manager)
  @ApiOperation({
    summary: 'Merge a duplicate customer into another',
    description:
      'The same customer entered twice: every invoice and payment of this one moves to `intoCustomerId`, a phone, email or surname the kept customer lacks is copied over, and this one is removed, remembering where it went.',
  })
  @ApiCreatedResponse({ type: CustomerMergeView })
  merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeCustomerDto,
  ): Promise<CustomerMergeView> {
    return this.svc.merge(id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a customer',
    description:
      'Chiefly how a customer is moved onto another price list, which is what decides the prices on their next sale.',
  })
  @ApiOkResponse({ type: CustomerView })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.svc.update(id, dto);
  }
}
