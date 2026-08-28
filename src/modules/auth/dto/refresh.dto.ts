import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @ApiPropertyOptional({
    description:
      'Omit when the refresh token is sent as an httpOnly cookie; the cookie takes precedence.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
