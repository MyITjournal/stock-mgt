import { ForbiddenException } from '@nestjs/common';
import { env } from '../../config/env';

/**
 * The refusal every self-serve account path gives when signup is off.
 *
 * ## Why this is checked in the service and not on the route
 *
 * A controller guard would cover the three endpoints that exist today. This
 * covers the three *operations*, which is what actually matters: the rule is
 * about minting a secret — a verification code, a password-reset token — not
 * about a URL. A route added later that reaches one of these paths inherits the
 * refusal without anybody remembering to decorate it, and a route that does not
 * mint anything is unaffected.
 *
 * That ordering is load-bearing for `env.ts`, which lets production boot with
 * no mail provider **only** when signup is off. If a path could still mint a
 * code with mail unconfigured, `MailService` would fall back to logging it —
 * and that fallback is exactly the account-takeover hole the requirement exists
 * to close. So this check is the thing standing behind that permission.
 *
 * ## What it deliberately does not do
 *
 * It does not vary by whether the account exists. `resendOtp` and
 * `forgotPassword` both answer the same way for a real and an unknown address,
 * on purpose, so they cannot be used to discover who has an account. This
 * refusal is about the *feature* being off on this instance, which is true
 * regardless, so it leaks nothing.
 */
export function assertSelfServeSignup(): void {
  if (env.SELF_SERVE_SIGNUP) return;

  throw new ForbiddenException({
    error: 'SELF_SERVE_DISABLED',
    message:
      'Accounts on this instance are set up for you rather than created online. Get in touch and we will have you running.',
  });
}
