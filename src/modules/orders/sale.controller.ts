import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SaleService } from './sale.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';

@ApiTags('sales')
@ApiBearerAuth('JWT')
@Controller('sales')
export class SaleController {
  constructor(private readonly svc: SaleService) {}

  @Get()
  @ApiOperation({ summary: 'List sales' })
  findAll() {
    return this.svc.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a sale' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Send a unique key per sale. A retry with the same key returns the original sale instead of recording a second one.',
  })
  @ApiOperation({ summary: 'Record a sale' })
  create(@Body() dto: CreateSaleDto) {
    return this.svc.create(dto);
  }
}
