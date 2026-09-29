import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CustomerView } from './dto/customer.response';
import {
  CreateCustomerDto,
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
