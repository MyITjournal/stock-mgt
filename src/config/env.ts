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
 */
const productionSchema = envSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  for (const key of ['RESEND_API_KEY', 'MAIL_FROM'] as const) {
    if (!value[key]) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          'required in production — without it, verification codes and password-reset links are written to the log instead of being sent',
      });
    }
  }
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
