import { PUBLIC_USER_SELECT_KEYS } from './actions/user.action';

/**
 * What a user record may never carry out of the API.
 *
 * `GET /users/:id` returned every one of these to any authenticated caller,
 * from any organization, including the argon2 password hash. The `@Exclude()`
 * decorators on the entity looked like protection and were inert:
 * `ClassSerializerInterceptor` was never registered, and the rows were plain
 * Prisma objects rather than class instances in any case.
 *
 * This test guards the *shape of the allow-list itself*, so the mistake cannot
 * be reintroduced by adding a field to a select somewhere far from here.
 */
const NEVER_EXPOSED = [
  'password',
  'otpHash',
  'otpExpiresAt',
  'lastLoginIp',
  'deletedAt',
];

describe('what a user record may expose', () => {
  it.each(NEVER_EXPOSED)('never returns %s', (field) => {
    expect(PUBLIC_USER_SELECT_KEYS).not.toContain(field);
  });

  it('is an allow-list, so a new column is invisible until somebody adds it', () => {
    // The point of selecting rather than excluding: adding a secret to the
    // schema cannot leak it by default. If this ever becomes a deny-list, the
    // failure mode flips from "invisible" to "exposed", which is how the
    // original bug happened.
    expect(PUBLIC_USER_SELECT_KEYS).toEqual(
      expect.arrayContaining(['id', 'email', 'firstName']),
    );
    expect(PUBLIC_USER_SELECT_KEYS.length).toBeLessThan(20);
  });
});
