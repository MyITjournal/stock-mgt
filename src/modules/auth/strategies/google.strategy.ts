import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { env } from '../../../config/env';

export interface GoogleProfile {
  email: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: env.CLIENT_ID ?? 'not-configured',
      clientSecret: env.CLIENT_SECRET ?? 'not-configured',
      callbackURL: env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/callback',
      scope: ['email', 'profile'],
    });
  }

  /**
   * Turns a Google profile into the three fields `AuthService` needs.
   *
   * The verified check is load-bearing, not ceremony. `googleLogin` matches on
   * the address alone: an existing password account with that address is linked
   * to the Google identity and signed straight in. So if Google were ever to
   * hand over an address it had not confirmed — which a Workspace domain can do
   * — presenting it would be enough to take over the matching account. Google
   * marks this on the profile; nothing was reading it.
   */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const primary = profile.emails?.[0];
    const email = primary?.value;
    if (!email) {
      done(new Error('Google account has no email address'), false);
      return;
    }

    // `verified` arrives as a boolean or the string "true" depending on the
    // payload, and is absent on some profiles. Absent is treated as unverified:
    // this is the direction that fails closed.
    const verified = (primary as { verified?: boolean | string }).verified;
    if (verified !== true && verified !== 'true') {
      done(
        new Error('Google has not verified this account’s email address'),
        false,
      );
      return;
    }

    const user: GoogleProfile = {
      email,
      firstName: profile.name?.givenName ?? '',
      lastName: profile.name?.familyName ?? '',
    };

    done(null, user);
  }
}
