/**
 * The boot rules.
 *
 * These used to refuse production without a mail provider whenever self-serve
 * signup was on. That moved into `auth/self-serve.ts`, which can ask the
 * narrower question — *can this request deliver what it is about to create* —
 * immediately before creating it. These tests pin the consequence: an instance
 * with no mail provider **boots**, and username sign-up works on it.
 */

type LoadedEnv = { SELF_SERVE_SIGNUP: boolean; NODE_ENV: string };

/**
 * Re-imports `env.ts` under a given environment.
 *
 * `env` is built once at import time, so the module registry has to be reset
 * between cases. Values are set as empty strings rather than deleted where they
 * must be absent: `dotenv` skips any key already present in `process.env`, and
 * `withoutEmptyStrings` then drops them before the schema runs — so an empty
 * string is how you say "definitely not set" in a way a local `.env` cannot
 * quietly undo.
 */
function loadWith(overrides: Record<string, string>): LoadedEnv | Error {
  const saved = { ...process.env };
  Object.assign(process.env, overrides);

  try {
    let loaded: LoadedEnv | Error = new Error('nothing was loaded');
    jest.isolateModules(() => {
      try {
        // The generic form, not a cast: `lint --fix` treats a cast from `any`
        // as unnecessary and deletes it, which turns this line back into an
        // unsafe member access on the next lint run.
        loaded = jest.requireActual<{ env: LoadedEnv }>('./env').env;
      } catch (caught) {
        loaded = caught as Error;
      }
    });
    return loaded;
  } finally {
    process.env = saved;
  }
}

const NO_MAIL = { RESEND_API_KEY: '', MAIL_FROM: '' };

describe('environment boot rules', () => {
  /**
   * The configuration this actually deploys with. It used to be refused.
   */
  it('boots production with signup on and no mail provider', () => {
    const result = loadWith({
      NODE_ENV: 'production',
      SELF_SERVE_SIGNUP: 'true',
      ...NO_MAIL,
    });

    expect(result).not.toBeInstanceOf(Error);
    expect((result as LoadedEnv).SELF_SERVE_SIGNUP).toBe(true);
  });

  it('boots production with signup off and no mail provider', () => {
    const result = loadWith({
      NODE_ENV: 'production',
      SELF_SERVE_SIGNUP: 'false',
      ...NO_MAIL,
    });

    expect(result).not.toBeInstanceOf(Error);
    expect((result as LoadedEnv).SELF_SERVE_SIGNUP).toBe(false);
  });

  it('boots production with mail configured', () => {
    const result = loadWith({
      NODE_ENV: 'production',
      SELF_SERVE_SIGNUP: 'true',
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'Reho <noreply@example.com>',
    });

    expect(result).not.toBeInstanceOf(Error);
  });

  it('leaves mail optional outside production', () => {
    expect(
      loadWith({ NODE_ENV: 'development', ...NO_MAIL }),
    ).not.toBeInstanceOf(Error);
  });

  /**
   * The safe default is the one that cannot strand a customer. Defaulting to
   * *off* would mean a deployment that forgot the variable silently stopped
   * accepting new shops, with nothing to indicate why.
   */
  it('defaults signup on', () => {
    const result = loadWith({ NODE_ENV: 'development' });
    expect((result as LoadedEnv).SELF_SERVE_SIGNUP).toBe(true);
  });

  /** The invariants that are still enforced at boot. */
  it('still refuses a database URL that is missing', () => {
    const result = loadWith({ NODE_ENV: 'production', DATABASE_URL: '' });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('DATABASE_URL');
  });

  it('still refuses a JWT secret that is too short', () => {
    const result = loadWith({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'short',
    });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('JWT_ACCESS_SECRET');
  });
});
