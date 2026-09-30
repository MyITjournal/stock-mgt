import { ForbiddenException } from '@nestjs/common';
import { env } from '../../config/env';
import { assertSelfServeSignup } from './self-serve';

/**
 * `env` is frozen at import time, so these flip the loaded object rather than
 * `process.env`, which nothing re-reads.
 */
const setSignup = (value: boolean) => {
  (env as { SELF_SERVE_SIGNUP: boolean }).SELF_SERVE_SIGNUP = value;
};

describe('assertSelfServeSignup', () => {
  const original = env.SELF_SERVE_SIGNUP;
  afterEach(() => setSignup(original));

  it('allows the caller through when signup is on', () => {
    setSignup(true);
    expect(() => assertSelfServeSignup()).not.toThrow();
  });

  it('refuses when signup is off', () => {
    setSignup(false);
    expect(() => assertSelfServeSignup()).toThrow(ForbiddenException);
  });

  /**
   * The code is what a client branches on; the sentence is what a person reads
   * and will be rewritten. Pinning the code stops a reword quietly breaking a
   * caller that was checking for it.
   */
  it('refuses with a machine-readable code, not only a sentence', () => {
    setSignup(false);
    try {
      assertSelfServeSignup();
      throw new Error('expected a refusal');
    } catch (caught) {
      const response = (caught as ForbiddenException).getResponse();
      expect(response).toMatchObject({ error: 'SELF_SERVE_DISABLED' });
    }
  });

  /**
   * The refusal must not depend on the account, because two of the three
   * endpoints it guards answer identically for a real and an unknown address
   * on purpose — otherwise they enumerate who has an account. A refusal that
   * took an identifier would be the obvious way to reintroduce that.
   */
  it('takes no argument, so it cannot vary by account', () => {
    expect(assertSelfServeSignup).toHaveLength(0);
  });
});
