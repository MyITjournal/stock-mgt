import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { AuthProvider, UserRole } from '@prisma/client';

/**
 * Re-exported from Prisma rather than redeclared. Locally declared copies of
 * these looked identical but were a separate type, so comparing a value read
 * off a domain object against a Prisma enum member was a type error.
 */
export { AuthProvider, UserRole };

export class User {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @Exclude()
  password!: string;

  @ApiProperty({ example: 'Jane', nullable: true })
  firstName!: string | null;

  @ApiProperty({ example: 'Doe', nullable: true })
  lastName!: string | null;

  @ApiProperty({
    example: 'Jane Doe',
    nullable: true,
    description: 'Computed from firstName and lastName',
  })
  fullName!: string | null;

  @ApiProperty({ nullable: true })
  bio!: string | null;

  @ApiProperty({ nullable: true })
  photoUrl!: string | null;

  @ApiProperty({ enum: UserRole, default: UserRole.user })
  role!: UserRole;

  @ApiProperty({ enum: AuthProvider, default: AuthProvider.email })
  authProvider!: AuthProvider;

  @ApiProperty({ default: false })
  isVerified!: boolean;

  @ApiProperty({ default: false })
  onboardingComplete!: boolean;

  @Exclude()
  otpHash!: string | null;

  @Exclude()
  otpExpiresAt!: Date | null;

  @Exclude()
  lastLoginIp!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @Exclude()
  deletedAt!: Date | null;
}
