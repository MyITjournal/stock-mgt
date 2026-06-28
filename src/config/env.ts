import { createEnv } from '@t3-oss/env-core';
import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'test', 'production', 'staging'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    FRONTEND_URL: z.string().url(),
    APP_URL: z.string().url(),
    DATABASE_URL: z.string().min(1),

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

    CLIENT_ID: z.string().min(1),
    CLIENT_SECRET: z.string().min(1),

    GOOGLE_CALLBACK_URL: z.string().url(),

    COOKIE_DOMAIN: z.string().default(''),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:5173')
      .transform((val) => val.split(',').map((v) => v.trim())),
    OTP_OVERRIDE: z.string().optional(),

    SWAGGER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM: z.string().min(1),
    CONTACT_EMAIL: z.string().min(1),

    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
