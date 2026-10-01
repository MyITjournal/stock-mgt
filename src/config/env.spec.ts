/**
 * The boot rules, which are the thing standing behind "production may run with
 * no mail provider".
 *
 * Worth testing rather than reading, because the failure they prevent is
 * silent: an instance that boots happily and then mints verification codes it
 * cannot deliver, or worse, writes them to the log. Nothing downstream would
 * complain.
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

const PRODUCTION_WITHOUT_MAIL = {
  NODE_ENV: 'production',
  RESEND_API_KEY: '',
  MAIL_FROM: '',
};

describe('environment boot rules', () => {
  it('refuses production when signup is on and mail is not configured', () => {
    const result = loadWith({
      ...PRODUCTION_WITHOUT_MAIL,
      SELF_SERVE_SIGNUP: 'true',
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('RESEND_API_KEY');
    expect((result as Error).message).toContain('MAIL_FROM');
  });

  /**
   * The whole point of the flag. Nothing can mint a verification code or a
   * reset token, so there is no secret for the log fallback to leak and no
   * reason to demand a provider.
   */
  it('allows production with no mail when signup is off', () => {
    const result = loadWith({
      ...PRODUCTION_WITHOUT_MAIL,
      SELF_SERVE_SIGNUP: 'false',
    });

    expect(result).not.toBeInstanceOf(Error);
    expect((result as LoadedEnv).SELF_SERVE_SIGNUP).toBe(false);
  });

  it('allows production with signup on once mail is configured', () => {
    const result = loadWith({
      NODE_ENV: 'production',
      SELF_SERVE_SIGNUP: 'true',
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'Reho <noreply@example.com>',
    });

    expect(result).not.toBeInstanceOf(Error);
    expect((result as LoadedEnv).SELF_SERVE_SIGNUP).toBe(true);
  });

  /**
   * Development keeps the logging fallback, which is what makes the local loop
   * and `npm run smoke` work without a provider at all.
   */
  it('leaves mail optional outside production', () => {
    const result = loadWith({
      NODE_ENV: 'development',
      RESEND_API_KEY: '',
      MAIL_FROM: '',
    });

    expect(result).not.toBeInstanceOf(Error);
  });

  /**
   * The safe default is the one that cannot strand an account. Defaulting to
   * *off* would mean a deployment that forgot the variable silently stopped
   * accepting signups; defaulting to *on* means it refuses to boot until
   * somebody says which shape they meant.
   */
  it('defaults signup on, so the omission is loud rather than silent', () => {
    const result = loadWith({ NODE_ENV: 'development' });
    expect((result as LoadedEnv).SELF_SERVE_SIGNUP).toBe(true);
  });
});
