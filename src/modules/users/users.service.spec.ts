jest.mock('uuid', () => ({
  v7: jest.fn().mockReturnValue('00000000-0000-0000-0000-000000000000'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { UsersService, EMAIL_ALREADY_EXISTS } from './users.service';
import { UserModelAction } from './actions/user.action';
import { ResetPasswordModelAction } from './actions/reset-password.action';
import { User, AuthProvider, UserRole } from './entities/user.entity';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('mocked-password-hash'),
}));

const baseUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  authProvider: AuthProvider.EMAIL,
  isVerified: false,
  role: UserRole.USER,
  otpHash: null,
  otpExpiresAt: null,
} as User;

describe('UsersService', () => {
  let service: UsersService;
  let action: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockAction = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserModelAction, useValue: mockAction },
        { provide: ResetPasswordModelAction, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    action = module.get(UserModelAction);
    jest.clearAllMocks();
  });

  describe('createEmailUser', () => {
    const dto = {
      email: 'test@example.com',
      password: 'StrongPass1!',
      firstName: 'Test',
      lastName: 'User',
    };

    const lowercasedEmail = 'test@example.com';

    it('creates a new user when email is not taken', async () => {
      action.findByEmail.mockResolvedValue(null);
      action.create.mockResolvedValue(baseUser);

      const result = await service.createEmailUser(dto);

      expect(action.findByEmail).toHaveBeenCalledWith(lowercasedEmail);
      expect(action.create).toHaveBeenCalledWith({
        createPayload: {
          email: lowercasedEmail,
          password: 'mocked-password-hash',
          authProvider: AuthProvider.EMAIL,
          role: UserRole.USER,
          firstName: dto.firstName,
          lastName: dto.lastName,
          otpHash: null,
          otpExpiresAt: null,
        },
        transactionOptions: { useTransaction: false as const },
      });
      expect(result).toEqual(baseUser);
    });

    it('throws ConflictException when email belongs to a verified user', async () => {
      const verifiedUser = { ...baseUser, isVerified: true };
      action.findByEmail.mockResolvedValue(verifiedUser);

      await expect(service.createEmailUser(dto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.createEmailUser(dto)).rejects.toMatchObject({
        response: { error: EMAIL_ALREADY_EXISTS },
      });

      expect(action.create).not.toHaveBeenCalled();
      expect(action.update).not.toHaveBeenCalled();
    });

    it('throws PENDING_VERIFICATION when existing user is unverified (with valid OTP)', async () => {
      const futureDate = new Date(Date.now() + 60_000);
      const unverifiedWithOTP = { ...baseUser, otpExpiresAt: futureDate };
      action.findByEmail.mockResolvedValue(unverifiedWithOTP);

      await expect(service.createEmailUser(dto)).rejects.toMatchObject({
        response: { error: 'PENDING_VERIFICATION' },
      });
      expect(action.create).not.toHaveBeenCalled();
      expect(action.update).not.toHaveBeenCalled();
    });

    it('throws PENDING_VERIFICATION when existing user is unverified (expired OTP)', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      const unverifiedExpired = { ...baseUser, otpExpiresAt: pastDate };
      action.findByEmail.mockResolvedValue(unverifiedExpired);

      await expect(service.createEmailUser(dto)).rejects.toMatchObject({
        response: { error: 'PENDING_VERIFICATION' },
      });
      expect(action.create).not.toHaveBeenCalled();
      expect(action.update).not.toHaveBeenCalled();
    });

    it('throws PENDING_VERIFICATION when existing user is unverified (no OTP set)', async () => {
      const unverifiedNoOtp = {
        ...baseUser,
        otpHash: null,
        otpExpiresAt: null,
      };
      action.findByEmail.mockResolvedValue(unverifiedNoOtp);

      await expect(service.createEmailUser(dto)).rejects.toMatchObject({
        response: { error: 'PENDING_VERIFICATION' },
      });
      expect(action.create).not.toHaveBeenCalled();
      expect(action.update).not.toHaveBeenCalled();
    });

    it('throws PENDING_VERIFICATION (not InternalServerErrorException) when unverified user exists', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      const unverifiedExpired = { ...baseUser, otpExpiresAt: pastDate };
      action.findByEmail.mockResolvedValue(unverifiedExpired);
      action.update.mockResolvedValue(null);

      await expect(service.createEmailUser(dto)).rejects.toMatchObject({
        response: { error: 'PENDING_VERIFICATION' },
      });
    });
  });
});
