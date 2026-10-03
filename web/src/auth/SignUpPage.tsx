import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth, useLandingPath } from './useAuth';
import { Field, Input } from '../components/Field';
import { Button } from '../components/Button';
import { BusinessTypeChoice } from '../components/BusinessTypeChoice';
import type { BusinessType } from '../lib/businessTypes';

/**
 * Creating a shop, with no email and nothing to wait for.
 *
 * ## Why there is no verification step
 *
 * This instance has no mail provider, so there is no code to send and nothing
 * to come back to. `POST /auth/sign-up` creates the shop and signs the person
 * in on the same request — a sign-up that ends at a login screen is one a
 * fair number of people abandon.
 *
 * ## Why the email box is here at all, and why it is optional
 *
 * Nothing is sent to it today. It is the only thing on this form that decides
 * whether this person can ever recover their own password: the day a mail
 * provider is configured, whoever filled it in can reset theirs, and whoever
 * skipped it still cannot. That is said on the screen rather than discovered
 * later, because it is their choice to make and it is not reversible by them.
 *
 * ## Why the kind of shop is asked, and why nothing is pre-selected
 *
 * It decides the price lists the shop starts with and how a new product's
 * units begin — a wholesaler should not have to untick "sold at the till" on
 * every piece it will never sell. It locks nothing and can be changed in
 * Settings, but a default nobody chose is a default nobody notices, so the
 * button stays disabled until one is picked.
 */
export function SignUpPage() {
  const { user, signUp } = useAuth();
  const landing = useLandingPath();

  const [shop, setShop] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={landing} replace />;

  const ready =
    shop.trim().length >= 2 &&
    firstName.trim() &&
    lastName.trim() &&
    username.trim().length >= 3 &&
    password.length >= 8 &&
    businessType !== null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      await signUp({
        organizationName: shop.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim().toLowerCase(),
        password,
        businessType: businessType ?? undefined,
        // Omitted rather than sent empty: the server treats absent as 'none',
        // and an empty string would fail its email check.
        ...(email.trim() ? { email: email.trim() } : {}),
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not create your shop. Try again.',
      );
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <Link to="/" className="text-base font-semibold tracking-tight text-brand-700">Reho</Link>
        <h1 className="mt-3 text-xl font-semibold text-slate-900">
          Create your shop
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          You will be using it in under a minute. Nothing to verify.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Shop name" htmlFor="shop">
            <Input
              id="shop"
              value={shop}
              onChange={(event) => setShop(event.target.value)}
              placeholder="Adebayo Stores"
              autoComplete="organization"
            />
          </Field>

          <fieldset>
            <legend className="block text-sm font-medium text-slate-700">
              What kind of shop is it?
            </legend>
            <div className="mt-1">
              <BusinessTypeChoice
                value={businessType}
                onChange={setBusinessType}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              It sets how your price lists and products start out. Every
              feature is open either way, and you can change it later.
            </p>
          </fieldset>

          <div className="flex gap-3">
            <Field label="First name" htmlFor="first">
              <Input
                id="first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
                className="w-full"
              />
            </Field>
            <Field label="Last name" htmlFor="last">
              <Input
                id="last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="family-name"
                className="w-full"
              />
            </Field>
          </div>

          <Field
            label="Username"
            htmlFor="username"
            hint="What you will sign in with. Letters, numbers, dot, dash, underscore."
          >
            <Input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="adebayo"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Field
            label="Email (optional)"
            htmlFor="email"
            hint="We send nothing to it. It is what will let you reset your own password later — without it, only we can."
          >
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
        </div>

        {error && (
          <p
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="mt-6 w-full" disabled={!ready || busy}>
          {busy ? 'Creating your shop…' : 'Create shop'}
        </Button>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have a shop?{' '}
          <Link to="/sign-in" className="font-medium text-brand-700 underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
