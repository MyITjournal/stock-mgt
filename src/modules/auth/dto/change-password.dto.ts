import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description:
      'The password being used now. Required because a session is not the same authority as a password.',
    example: 'correct-horse-battery',
  })
  @IsString()
  currentPassword!: string;

  @ApiProperty({
    description: 'The new password. At least 8 characters.',
    example: 'a-much-better-one',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'A password needs at least 8 characters.' })
  newPassword!: string;
}

export class ChangePasswordResponse {
  @ApiProperty({
    example: 'Password changed. Everyone signed in as you has been signed out.',
  })
  message!: string;
}
