import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ required: false, nullable: true, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  photoUrl?: string | null;
}
