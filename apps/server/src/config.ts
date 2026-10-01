import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

function initEnv(): void {
  const cwdEnv = path.resolve(process.cwd(), '.env');
  const rootEnv = path.resolve(process.cwd(), '../../.env');
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  } else if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}
initEnv();

export const ServerConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  DATABASE_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  SQLITE_PATH: z.string().default('./data/tether.db'),
  DATABASE_URL: z.string().optional(),
  HOST_GRACE_MS: z.coerce.number().int().positive().default(5000),
  PERSIST_FLUSH_MS: z.coerce.number().int().positive().default(250),
  ROOM_UNLOAD_IDLE_MS: z.coerce.number().int().positive().default(30000),
  DEMO_MODE: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    const knownInsecure = [
      'development_secret_must_be_at_least_32_chars_long!!',
      'production_secret_must_be_at_least_32_characters_long!',
    ];
    if (knownInsecure.includes(data.JWT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET cannot use an insecure default placeholder in production',
      });
    }
  }
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const result = ServerConfigSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted)}`);
  }
  return result.data;
}
