import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import { UserModelAction } from './actions/user.action';
import { ResetPasswordModelAction } from './actions/reset-password.action';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationDto } from './dto/pagination.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthProvider, User, UserRole } from './entities/user.entity';
import { ResetPassword } from '../auth/entities/reset-password.entity';

const NO_TRANSACTION = {
  transactionOptions: { useTransaction: false as const },
};

export const EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS';

@Injectable()
export class UsersService {
  constructor(
    private readonly userModelAction: UserModelAction,
    private readonly resetPasswordAction: ResetPasswordModelAction,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userModelAction.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await argon2.hash(dto.password);
    return this.userModelAction.create({
      ...NO_TRANSACTION,
      createPayload: {
        email: dto.email,
        password: passwordHash,
        role: dto.role,
      },
    });
  }

  findAll(pagination: PaginationDto) {
    return this.userModelAction.list({
      paginationPayload: { page: pagination.page!, limit: pagination.limit! },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModelAction.get({
      identifierOptions: { id },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userModelAction.findByEmail(email);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    await this.findOne(id);

    const payload: Partial<User> = { ...dto };
    if (dto.password) {
      payload.password = await argon2.hash(dto.password);
    }

    const updated = await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: payload,
    });
    if (!updated) {
      throw new InternalServerErrorException('Failed to update user');
    }
    return updated;
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    // Existence check — throws if the user is missing.
    await this.findOne(userId);

    const payload: Partial<User> = {};

    if (dto.firstName !== undefined) payload.firstName = dto.firstName;
    if (dto.lastName !== undefined) payload.lastName = dto.lastName;
    if (dto.bio !== undefined) payload.bio = dto.bio;
    if (dto.photoUrl !== undefined) payload.photoUrl = dto.photoUrl;

    const updated = await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id: userId },
      updatePayload: payload,
    });

    if (!updated) {
      throw new InternalServerErrorException('Failed to update profile');
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.userModelAction.delete({
      ...NO_TRANSACTION,
      identifierOptions: { id },
    });
  }

  async markOnboardingComplete(userId: string): Promise<User> {
    await this.findOne(userId);
    const updated = await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id: userId },
      updatePayload: { onboardingComplete: true },
    });
    if (!updated) {
      throw new InternalServerErrorException(
        'Failed to mark onboarding complete',
      );
    }
    return updated;
  }

  async setPasswordResetToken(
    id: string,
    tokenSelector: string,
    tokenHash: string,
    expires: Date,
  ): Promise<ResetPassword> {
    return this.resetPasswordAction.create({
      transactionOptions: { useTransaction: false },
      createPayload: {
        id: uuidv7(),
        userId: id,
        tokenSelector,
        tokenHash,
        expiresAt: expires,
        used: false,
      },
    });
  }

  async findByValidResetToken(
    tokenSelector: string,
  ): Promise<{ user: User; resetPassword: ResetPassword } | null> {
    const resetPassword =
      await this.resetPasswordAction.findByValidSelector(tokenSelector);
    if (!resetPassword) return null;

    const user = await this.findOne(resetPassword.userId);
    return { user, resetPassword };
  }

  async clearPasswordResetToken(id: string): Promise<void> {
    await this.resetPasswordAction.deleteByUserId(id);
  }

  async markPasswordResetAsUsed(resetPasswordId: string): Promise<void> {
    await this.resetPasswordAction.markAsUsed(resetPasswordId);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await argon2.hash(newPassword);
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: { password: passwordHash },
    });
  }

  async updateLastLoginIp(id: string, ip: string): Promise<void> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: { lastLoginIp: ip },
    });
  }

  async findResetTokenBySelector(
    tokenSelector: string,
  ): Promise<ResetPassword | null> {
    return this.resetPasswordAction.findBySelector(tokenSelector);
  }

  async createEmailUser(dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<User> {
    const lowercasedEmail = dto.email.toLowerCase();
    const existing = await this.userModelAction.findByEmail(lowercasedEmail);
    if (existing) {
      if (existing.isVerified) {
        throw new ConflictException({
          error: EMAIL_ALREADY_EXISTS,
          message: 'An account with this email already exists.',
        });
      }

      // Unverified — reject and direct to resend-otp
      throw new ConflictException({
        error: 'PENDING_VERIFICATION',
        message:
          'An account with this email is already registered and awaiting verification. Please check your inbox or request a new verification code.',
      });
    }

    const passwordHash = await argon2.hash(dto.password);
    return this.userModelAction.create({
      ...NO_TRANSACTION,
      createPayload: {
        email: lowercasedEmail,
        password: passwordHash,
        authProvider: AuthProvider.email,
        role: UserRole.user,
        firstName: dto.firstName,
        lastName: dto.lastName,
        otpHash: null,
        otpExpiresAt: null,
      },
    });
  }

  async storeOtpHash(
    userId: string,
    otpHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id: userId },
      updatePayload: { otpHash, otpExpiresAt: expiresAt },
    });
  }

  async clearOtp(userId: string): Promise<void> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id: userId },
      updatePayload: { otpHash: null, otpExpiresAt: null, isVerified: true },
    });
  }

  async clearOtpOnly(userId: string): Promise<void> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id: userId },
      updatePayload: { otpHash: null, otpExpiresAt: null },
    });
  }

  async linkGoogleAccount(id: string): Promise<void> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: { authProvider: AuthProvider.google },
    });
  }

  async createGoogleUser(dto: {
    email: string;
    firstName: string;
    lastName: string;
    isVerified: boolean;
    onboardingComplete: boolean;
  }): Promise<User> {
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await argon2.hash(randomPassword);
    return this.userModelAction.create({
      ...NO_TRANSACTION,
      createPayload: {
        email: dto.email,
        password: passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        authProvider: AuthProvider.google,
        isVerified: dto.isVerified,
        onboardingComplete: dto.onboardingComplete,
        role: UserRole.user,
      },
    });
  }

  logOAuthLogin(userId: string, ipAddress: string, provider: string): void {
    console.log(
      `OAuth login: userId=${userId} provider=${provider} ip=${ipAddress} time=${new Date().toISOString()}`,
    );
  }

  async findLatestActiveByUserId(
    userId: string,
  ): Promise<ResetPassword | null> {
    return this.resetPasswordAction.findByUserId(userId);
  }

  async invalidateAllByUserId(userId: string): Promise<void> {
    await this.resetPasswordAction.invalidateAllByUserId(userId);
  }
}
