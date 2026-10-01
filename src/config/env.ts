import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Variables are promoted from optional to required as the slice that needs them
 * lands. Requiring a secret before any code reads it only blocks boot.
 *
 * Required today (Slice 1): DATABASE_URL, JWT_* secrets, FRONTEND_URL, APP_URL.
 * RESEND_* and CLIENT_* stay optional: mail falls back to logging, and Google
 * sign-in is only reachable once its credentials are set.
 * Slice 2 (product images) promotes CLOUDINARY_*.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production', 'staging'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),

  /**
   * How many Postgres connections this process may hold.
   *
   * Sized here rather than as `?connection_limit=` on the URL, which the `pg`
   * driver adapter does not read — see `PrismaService`. Five leaves headroom
   * under a small hosted instance's cap for migrations, `psql` and a second
   * instance during a rolling deploy.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),

  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((val) => val.split(',').map((v) => v.trim())),
  /**
   * Off unless asked for. Swagger is a complete map of the API, and a default
   * of `true` means a deploy that simply forgets to set it publishes that map.
   * Defaults should fail closed; `.env.example` turns it on for development.
   */
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // --- Slice 1: auth ---
  FRONTEND_URL: z.url(),
  APP_URL: z.url(),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_RESET_SECRET: z
    .string()
    .min(32, 'JWT_RESET_SECRET must be at least 32 chars'),

  COOKIE_DOMAIN: z.string().default(''),
  OTP_OVERRIDE: z.string().optional(),

  /**
   * Whether a stranger may create an account and an organization for
   * themselves.
   *
   * **On**, now that there is a sign-up screen needing no mail provider. It
   * governs the three paths that create an account for a stranger: username
   * sign-up, emailed registration, and both doors of Google sign-in.
   *
   * It no longer governs `forgot-password`, which is recovery rather than
   * signup and is gated on mail being configured instead. Nor does it decide
   * whether mail is required at boot — see the production rules below. That
   * question now belongs to each path that actually sends something.
   *
   * Turn it off to close an instance to new shops entirely, which is what a
   * demonstration or a single customer's private deployment would want.
   */
  SELF_SERVE_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  CLIENT_ID: z.string().min(1).optional(),
  CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_CALLBACK_URL: z.url().optional(),

  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  CONTACT_EMAIL: z.string().min(1).optional(),

  // --- Slice 2: product images ---
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
});

/** Treat `KEY=` in a .env file as "not set" so schema defaults apply. */
function withoutEmptyStrings(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ''),
  );
}

/**
 * Rules that only bite on a real deployment.
 *
 * Kept out of the field definitions above because they are conditional: mail is
 * genuinely optional on a developer machine, where `MailService` falling back
 * to the log is the whole point. In production that same fallback writes every
 * verification code and every password-reset URL into the platform log in
 * plaintext — a full account-takeover path for anyone who can read it, which on
 * a hosted dashboard is a wider group than it looks.
 *
 * Refused at boot rather than warned about, for the same reason `OTP_OVERRIDE`
 * is refused at boot: a note is not a control, and the failure is silent until
 * somebody has already been locked out of their own business.
 *
 * ## Why mail is no longer required at all
 *
 * The rule being protected is not "mail must be configured" — it is **no path
 * may mint a secret it cannot deliver**. An account whose verification code
 * goes nowhere is an account nobody can ever sign in to.
 *
 * This file used to hold that rule by refusing to boot: signup on meant mail
 * required. That worked while **email was the only way to sign up**. Once a
 * shop can be created with a username and a password, refusing to boot would
 * demand a mail provider for a path that never sends anything.
 *
 * So the rule moved to where it can be precise. `assertMailAvailable()` in
 * `auth/self-serve.ts` guards each path that mints a secret — emailed
 * registration, resending a code, password reset — and answers 503 when there
 * is no provider. Username sign-up is unaffected, because it mints nothing.
 *
 * **This is a narrower control, not a weaker one.** Before, the check was "is
 * mail configured *somewhere* in this process"; now it is "can *this request*
 * deliver what it is about to create", asked immediately before creating it.
 * The combination that used to be refused at boot — registering into a void —
 * is now impossible by construction rather than by configuration.
 *
 * `MailService` keeps its own guard as the last line: asked to send in
 * production with nothing configured, it logs that delivery failed and
 * deliberately never logs the contents.
 */
const productionSchema = envSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  // Deliberately empty of mail checks. Kept as the place production-only rules
  // go, because the next one will want somewhere to live and `superRefine` on
  // a schema with no refinements is easy to delete by accident.
  void ctx;
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = productionSchema.safeParse(withoutEmptyStrings(process.env));

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export type Env = typeof env;
