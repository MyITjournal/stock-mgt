import { Injectable } from '@nestjs/common';
import { Prisma, ResetPassword as PrismaResetPassword } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ResetPassword } from '../../auth/entities/reset-password.entity';

@Injectable()
export class ResetPasswordModelAction {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(item: PrismaResetPassword | null): ResetPassword | null {
    return item as unknown as ResetPassword | null;
  }

  async create(options: {
    transactionOptions?: unknown;
    createPayload: Partial<ResetPassword>;
  }): Promise<ResetPassword> {
    const created = await this.prisma.resetPassword.create({
      data: options.createPayload as Prisma.ResetPasswordUncheckedCreateInput,
    });
    return created as unknown as ResetPassword;
  }

  async update(options: {
    transactionOptions?: unknown;
    identifierOptions: Partial<Pick<ResetPassword, 'id'>>;
    updatePayload: Partial<ResetPassword>;
  }): Promise<ResetPassword | null> {
    await this.prisma.resetPassword.update({
      where: { id: options.identifierOptions.id },
      data: options.updatePayload as Prisma.ResetPasswordUncheckedUpdateInput,
    });
    const found = await this.prisma.resetPassword.findUnique({
      where: { id: options.identifierOptions.id },
    });
    return this.toDomain(found);
  }

  async findBySelector(tokenSelector: string): Promise<ResetPassword | null> {
    const found = await this.prisma.resetPassword.findFirst({
      where: { tokenSelector },
    });
    return this.toDomain(found);
  }

  async findByValidSelector(
    tokenSelector: string,
  ): Promise<ResetPassword | null> {
    const found = await this.prisma.resetPassword.findFirst({
      where: {
        tokenSelector,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    return this.toDomain(found);
  }

  async findByUserId(userId: string): Promise<ResetPassword | null> {
    const found = await this.prisma.resetPassword.findFirst({
      where: {
        userId,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
    });
    return this.toDomain(found);
  }

  async markAsUsed(id: string): Promise<void> {
    await this.update({
      transactionOptions: { useTransaction: false },
      identifierOptions: { id },
      updatePayload: { used: true },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.resetPassword.deleteMany({ where: { userId } });
  }

  // Invalidates ALL active tokens for a user before issuing a new one
  async invalidateAllByUserId(userId: string): Promise<void> {
    await this.prisma.resetPassword.updateMany({
      where: { userId, used: false },
      data: { used: true },
    });
  }
}
