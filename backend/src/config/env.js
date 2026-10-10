import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { resolve } from 'node:path';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));

const integerSetting = (fallback, min, max) => z.preprocess(
  (value) => value === undefined ? String(fallback) : value,
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max)),
);

const originList = z.string().default('').transform((value) =>
  [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean))],
).pipe(z.array(z.string().refine((origin) => {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
  } catch {
    return false;
  }
}, 'Use an exact http(s) origin without paths, credentials, or trailing slashes')));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).regex(/^[a-zA-Z0-9.:-]+$/).default('127.0.0.1'),
  PORT: integerSetting(3000, 1, 65535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  JSON_BODY_LIMIT_BYTES: integerSetting(65536, 1024, 1048576),
  SHUTDOWN_TIMEOUT_MS: integerSetting(10000, 100, 120000),
  CORS_ORIGINS: originList,
  DATABASE_PATH: z.string().trim().min(1).max(4096).refine((value) => !value.includes('\0'))
    .default('storage/docuai.sqlite'),
  DATABASE_BUSY_TIMEOUT_MS: integerSetting(5000, 0, 30000),
  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/).default('gemini-2.5-flash'),
}).superRefine((values, context) => {
  if (values.NODE_ENV === 'production' && values.DATABASE_PATH === ':memory:') {
    context.addIssue({ code: 'custom', path: ['DATABASE_PATH'], message: 'Production requires persistent storage' });
  }
});

export class ConfigurationError extends Error {
  constructor(fields) {
    // Report setting names only; never echo environment values or secrets.
    super(`Invalid environment configuration: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
    this.fields = fields;
  }
}

export function parseEnv(env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigurationError([...new Set(result.error.issues.map((issue) => issue.path[0]))]);
  }
  const values = result.data;
  return Object.freeze({
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    jsonBodyLimitBytes: values.JSON_BODY_LIMIT_BYTES,
    shutdownTimeoutMs: values.SHUTDOWN_TIMEOUT_MS,
    corsOrigins: Object.freeze(values.CORS_ORIGINS),
    databasePath: values.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(backendRoot, values.DATABASE_PATH),
    databaseBusyTimeoutMs: values.DATABASE_BUSY_TIMEOUT_MS,
    geminiApiKey: values.GEMINI_API_KEY,
    geminiModel: values.GEMINI_MODEL,
  });
}

export function loadConfig({
  env = process.env,
  envFile = fileURLToPath(new URL('../../.env', import.meta.url)),
} = {}) {
  const result = dotenv.config({ path: envFile, processEnv: env, quiet: true, override: false });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new ConfigurationError(['.env (unreadable)']);
  }
  return parseEnv(env);
}
