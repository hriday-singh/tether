import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('Server Config', () => {
  it('loads valid configuration with defaults', () => {
    const config = loadConfig({
      JWT_SECRET: 'super_secret_jwt_key_that_is_at_least_32_characters_long',
    });

    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.DATABASE_DRIVER).toBe('sqlite');
    expect(config.HOST_GRACE_MS).toBe(5000);
    expect(config.DEMO_MODE).toBe(false);
    expect(config.ALLOWED_ORIGINS).toContain('http://localhost:3000');
  });

  it('rejects JWT_SECRET shorter than 32 characters', () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: 'too-short',
      })
    ).toThrow(/JWT_SECRET must be at least 32 characters long/);
  });

  it('parses comma-separated ALLOWED_ORIGINS and DEMO_MODE boolean', () => {
    const config = loadConfig({
      JWT_SECRET: 'super_secret_jwt_key_that_is_at_least_32_characters_long',
      ALLOWED_ORIGINS: 'https://app.tether.dev, https://preview.tether.dev',
      DEMO_MODE: 'true',
    });

    expect(config.ALLOWED_ORIGINS).toEqual([
      'https://app.tether.dev',
      'https://preview.tether.dev',
    ]);
    expect(config.DEMO_MODE).toBe(true);
  });
});
