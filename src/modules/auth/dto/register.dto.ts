import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Adebayo' })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Ogundipe' })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({
    example: 'Adebayo Stores',
    description: 'Business name. Creates the organization you own.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  organizationName!: string;
}
