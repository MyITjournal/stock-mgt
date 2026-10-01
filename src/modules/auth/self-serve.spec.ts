import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '../../config/env';
import {
  assertMailAvailable,
  assertSelfServeSignup,
  canDeliverSecrets,
  mailIsConfigured,
} from './self-serve';

/**
 * `env` is frozen at import time, so these flip the loaded object rather than
 * `process.env`, which nothing re-reads.
 */
type Mutable = {
  SELF_SERVE_SIGNUP: boolean;
  NODE_ENV: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
};
const set = (patch: Partial<Mutable>) => Object.assign(env as Mutable, patch);

describe('account-path guards', () => {
  const original: Mutable = {
    SELF_SERVE_SIGNUP: env.SELF_SERVE_SIGNUP,
    NODE_ENV: env.NODE_ENV,
    RESEND_API_KEY: env.RESEND_API_KEY,
    MAIL_FROM: env.MAIL_FROM,
  };
  afterEach(() => set(original));

  describe('assertSelfServeSignup', () => {
    it('allows the caller through when signup is on', () => {
      set({ SELF_SERVE_SIGNUP: true });
      expect(() => assertSelfServeSignup()).not.toThrow();
    });

    it('refuses when signup is off', () => {
      set({ SELF_SERVE_SIGNUP: false });
      expect(() => assertSelfServeSignup()).toThrow(ForbiddenException);
    });

    /**
     * The code is what a client branches on; the sentence is what a person
     * reads and will be rewritten. Pinning the code stops a reword quietly
     * breaking a caller that was checking for it.
     */
    it('refuses with a machine-readable code, not only a sentence', () => {
      set({ SELF_SERVE_SIGNUP: false });
      try {
        assertSelfServeSignup();
        throw new Error('expected a refusal');
      } catch (caught) {
        expect((caught as ForbiddenException).getResponse()).toMatchObject({
          error: 'SELF_SERVE_DISABLED',
        });
      }
    });

    /**
     * Must not depend on the account: two of the paths it sits beside answer
     * identically for a real and an unknown address on purpose, so they cannot
     * be used to discover who has an account. A guard taking an identifier
     * would be the obvious way to reintroduce that.
     */
    it('takes no argument, so it cannot vary by account', () => {
      expect(assertSelfServeSignup).toHaveLength(0);
    });
  });

  describe('assertMailAvailable', () => {
    it('allows the caller through when a provider is configured', () => {
      set({ RESEND_API_KEY: 're_test', MAIL_FROM: 'Reho <no@reply.test>' });
      expect(mailIsConfigured()).toBe(true);
      expect(() => assertMailAvailable()).not.toThrow();
    });

    it('refuses when there is no provider', () => {
      set({
        NODE_ENV: 'production',
        RESEND_API_KEY: undefined,
        MAIL_FROM: undefined,
      });
      expect(mailIsConfigured()).toBe(false);
      expect(() => assertMailAvailable()).toThrow(ServiceUnavailableException);
    });

    /** Half-configured is not configured — a key with no sender sends nothing. */
    it('refuses when only one half is set', () => {
      set({
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test',
        MAIL_FROM: undefined,
      });
      expect(() => assertMailAvailable()).toThrow(ServiceUnavailableException);
      set({
        NODE_ENV: 'production',
        RESEND_API_KEY: undefined,
        MAIL_FROM: 'Reho <no@reply.test>',
      });
      expect(() => assertMailAvailable()).toThrow(ServiceUnavailableException);
    });

    /**
     * 503, not 403. The caller did nothing wrong and the answer may differ
     * tomorrow — it is a missing capability, not a refusal of this person.
     */
    it('answers 503 with a code, because it is a missing capability', () => {
      set({
        NODE_ENV: 'production',
        RESEND_API_KEY: undefined,
        MAIL_FROM: undefined,
      });
      try {
        assertMailAvailable();
        throw new Error('expected a refusal');
      } catch (caught) {
        const error = caught as ServiceUnavailableException;
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toMatchObject({
          error: 'EMAIL_UNAVAILABLE',
        });
      }
    });
  });

  /**
   * The local loop depends on this, and the first version of the split broke
   * it: `npm run smoke` sets up its organization through `register`, which
   * mints a code and reads it back out of the server log. Treating a developer
   * machine as unable to deliver closed `register` everywhere and took the
   * whole suite with it.
   */
  describe('outside production, the log is the delivery mechanism', () => {
    it('allows minting with no provider, because MailService logs the code', () => {
      set({
        NODE_ENV: 'development',
        RESEND_API_KEY: undefined,
        MAIL_FROM: undefined,
      });
      expect(canDeliverSecrets()).toBe(true);
      expect(() => assertMailAvailable()).not.toThrow();
    });

    it('but production still requires a real provider', () => {
      set({
        NODE_ENV: 'production',
        RESEND_API_KEY: undefined,
        MAIL_FROM: undefined,
      });
      expect(canDeliverSecrets()).toBe(false);
      expect(() => assertMailAvailable()).toThrow(ServiceUnavailableException);
    });
  });

  /**
   * The point of splitting them. Username sign-up mints nothing, so it must
   * survive an instance with no mail provider — which is the configuration
   * this deploys with.
   */
  it('signup stays open with no mail provider, while sending paths close', () => {
    set({
      NODE_ENV: 'production',
      SELF_SERVE_SIGNUP: true,
      RESEND_API_KEY: undefined,
      MAIL_FROM: undefined,
    });
    expect(() => assertSelfServeSignup()).not.toThrow();
    expect(() => assertMailAvailable()).toThrow(ServiceUnavailableException);
  });
});
