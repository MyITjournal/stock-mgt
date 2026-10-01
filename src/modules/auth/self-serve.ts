import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '../../config/env';

/**
 * The two questions every account path has to ask, kept apart because they are
 * genuinely different questions.
 *
 * ## Why this used to be one check, and why that stopped working
 *
 * `SELF_SERVE_SIGNUP=false` originally switched off *all three* of `register`,
 * `resend-otp` and `forgot-password` together, and that was what let production
 * boot with no mail provider: nothing could mint a verification code or a reset
 * token, so there was nothing to deliver and nothing to leak.
 *
 * That was right while **email was the only way to sign up**. Once somebody can
 * create a shop with a username and a password, the two concerns come apart:
 *
 * - *May a stranger create an account at all?* — a product decision.
 * - *Can this instance actually deliver an email?* — a configuration fact.
 *
 * Username sign-up needs the first and not the second. Emailed registration and
 * password reset need both. Collapsing them meant turning off the one to avoid
 * paying for the other.
 *
 * ## The invariant that still holds
 *
 * No path may mint a secret it cannot deliver. {@link assertMailAvailable}
 * guards every path that mints one, so an account whose verification code goes
 * nowhere — an account nobody can ever sign in to — cannot be created. That is
 * the rule; requiring a mail provider at boot was only ever one way of keeping
 * it.
 */

/** Whether a real provider is configured. */
export function mailIsConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

/**
 * Whether this instance can get a verification code or a reset link to the
 * person who needs it — which is not the same question as whether a provider
 * is configured.
 *
 * **Outside production, the log is the delivery mechanism.** `MailService`
 * writes the code to the console when it has no provider, and that is not a
 * degraded fallback — it is how the local loop and `npm run smoke` read the
 * code back. Treating a developer machine as unable to deliver would close
 * `register` on every machine in the project and take the smoke suite with it.
 *
 * In production that same write is an account-takeover path for anyone who can
 * read logs, so `MailService` refuses to log the contents there, and this
 * refuses to mint them in the first place.
 */
export function canDeliverSecrets(): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return mailIsConfigured();
}

/**
 * May a stranger create an account and an organization for themselves?
 *
 * Checked in the service rather than on the route, because the rule is about
 * creating an account, not about a URL — a route added later inherits it. It
 * guards the username sign-up, emailed registration, and **both** doors of
 * Google sign-in, which is the one that gets missed: Google creates a user and
 * an organization while never minting a code, so it sails past any check aimed
 * only at the emailed routes.
 */
export function assertSelfServeSignup(): void {
  if (env.SELF_SERVE_SIGNUP) return;

  throw new ForbiddenException({
    error: 'SELF_SERVE_DISABLED',
    message:
      'Accounts on this instance are set up for you rather than created online. Get in touch and we will have you running.',
  });
}

/**
 * Can this instance deliver the secret this path is about to mint?
 *
 * Guards emailed registration, resending a verification code, and password
 * reset. **503 rather than 403**, because the caller did nothing wrong and the
 * answer may be different tomorrow — it is a missing capability, not a refusal.
 *
 * It deliberately does not vary by whether the account exists: `resend-otp` and
 * `forgot-password` both answer identically for a real and an unknown address
 * on purpose, so they cannot be used to discover who has an account.
 */
export function assertMailAvailable(): void {
  if (canDeliverSecrets()) return;

  throw new ServiceUnavailableException({
    error: 'EMAIL_UNAVAILABLE',
    message:
      'This instance cannot send email yet, so anything needing a code or a reset link is unavailable. Sign up with a username instead, or ask us to reset your password.',
  });
}
