import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReturnLineDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The line on the original invoice these goods came from.',
  })
  @IsUUID()
  saleLineId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The unit being handed back. Defaults to the unit the line was sold in.',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description:
      'Counted in `unitId`. Cannot exceed what is still outstanding.',
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'False when the goods came back broken: the customer is still refunded, but nothing goes back into sellable stock and no movement is written.',
  })
  @IsOptional()
  @IsBoolean()
  restocked?: boolean;

  @ApiPropertyOptional({ example: 'Wrong flavour.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateReturnDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, used as the returnGroupId that ties the lines handed back in one visit together.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ example: 'Customer brought them back on Friday.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Defaults to now; an offline device sends its own clock.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiProperty({ type: [ReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}
