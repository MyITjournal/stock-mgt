import { PerUserThrottlerGuard } from './per-user.throttler';

/**
 * `getTracker` is protected, and the whole behaviour of this class lives in it.
 * Reaching it through a subclass is cheaper and clearer than standing up a Nest
 * module, storage and a real request for what is a one-line decision.
 */
class Probe extends PerUserThrottlerGuard {
  track(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}

describe('PerUserThrottlerGuard', () => {
  const guard = Object.create(Probe.prototype) as Probe;

  it('counts two cashiers on one shop wifi separately', async () => {
    // The bug this exists to fix. Same router, same public address, so the
    // default IP tracker gave the whole counter one shared allowance and a
    // busy hour looked to staff like the app randomly breaking.
    const ip = '102.89.34.7';

    const amina = await guard.track({ ip, user: { sub: 'user-amina' } });
    const ibrahim = await guard.track({ ip, user: { sub: 'user-ibrahim' } });

    expect(amina).not.toBe(ibrahim);
  });

  it('gives one person the same allowance across their devices', async () => {
    // A rep on a phone and a tablet is still one person spending one quota.
    const phone = await guard.track({ ip: '1.1.1.1', user: { sub: 'user-a' } });
    const tablet = await guard.track({
      ip: '2.2.2.2',
      user: { sub: 'user-a' },
    });

    expect(phone).toBe(tablet);
  });

  it('falls back to the address when nobody is signed in', async () => {
    // Login, register and reset have no user by definition, so they keep the
    // per-address limits that stop password guessing.
    expect(await guard.track({ ip: '9.9.9.9' })).toBe('ip:9.9.9.9');
  });

  it('keeps user ids and addresses in separate namespaces', async () => {
    // Without the prefixes, a user id shaped like an address could share a
    // bucket with a real one.
    const byUser = await guard.track({
      ip: '5.5.5.5',
      user: { sub: '5.5.5.5' },
    });

    expect(byUser).toBe('user:5.5.5.5');
    expect(byUser).not.toBe(await guard.track({ ip: '5.5.5.5' }));
  });

  it('does not throw when the address is missing', async () => {
    // A unix socket or a stripped proxy header leaves req.ip undefined, and a
    // rate limiter must not be the thing that takes the API down.
    await expect(guard.track({})).resolves.toBe('ip:unknown');
  });
});
