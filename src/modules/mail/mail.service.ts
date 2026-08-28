import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../../config/env';

/**
 * Thin Resend wrapper.
 *
 * With no RESEND_API_KEY configured it logs the message instead of sending, so
 * OTP and password-reset flows are fully testable in development before a
 * sender domain has been verified.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend = env.RESEND_API_KEY
    ? new Resend(env.RESEND_API_KEY)
    : null;

  private async send(to: string, subject: string, html: string, plain: string) {
    if (!this.resend || !env.MAIL_FROM) {
      this.logger.warn(
        `[mail not configured] to=${to} subject="${subject}" :: ${plain}`,
      );
      return;
    }

    try {
      await this.resend.emails.send({
        from: env.MAIL_FROM,
        to,
        subject,
        html,
      });
    } catch (error) {
      // A failed send must not fail the request that triggered it — the user can
      // always request another code.
      this.logger.error(
        `Failed to send "${subject}" to ${to}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  sendVerificationOtp(to: string, code: string): Promise<void> {
    return this.send(
      to,
      'Verify your email',
      `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      `verification code=${code}`,
    );
  }

  sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    return this.send(
      to,
      'Reset your password',
      `<p>Reset your password using this link: <a href="${resetUrl}">${resetUrl}</a></p>
       <p>The link expires in 30 minutes. Ignore this email if you did not request it.</p>`,
      `reset url=${resetUrl}`,
    );
  }
}
