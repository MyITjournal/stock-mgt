import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting counted per signed-in person, falling back to the IP address
 * for anyone who is not signed in yet.
 *
 * The default guard counts by IP alone, which is wrong for this product. A shop
 * has one wifi router, so four cashiers on the counter share a single public
 * address and therefore a single allowance: recording a sale takes several
 * requests, and a busy hour would start returning 429s that look to the staff
 * like the app randomly breaking. Nigerian mobile networks make it worse —
 * carriers put many subscribers behind one shared address, so two reps in
 * different towns can throttle each other.
 *
 * Counting per user fixes that without weakening the protection that matters.
 * The routes worth brute-forcing — login, register, resend-otp, reset — have no
 * authenticated user by definition, so they fall through to the IP and keep
 * exactly the limits they had.
 *
 * This works only because `JwtAuthGuard` is registered *before* the throttler in
 * `AppModule`, so `request.user` is already populated. Reordering those guards
 * would silently turn this back into IP-only limiting.
 */
@Injectable()
export class PerUserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { sub?: string } | undefined;

    // Prefixed so a user id can never collide with an IP address in the
    // storage keyspace.
    if (user?.sub) return Promise.resolve(`user:${user.sub}`);

    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }
}
