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

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google account has no email address'), false);
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
