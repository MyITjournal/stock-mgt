import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from './useAuth';
import { Field, Input } from '../components/Field';
import { Button } from '../components/Button';

interface RedirectState {
  from?: { pathname: string };
}

/**
 * Signing in with an email **or** a username.
 *
 * Both, because most cashiers in this market have no working email address:
 * `User.email` is nullable and `User.username` sits beside it, qualified by the
 * organization slug so `amina` is unique without anybody thinking about it
 * (DECISIONS.md §9). The server takes either and refuses both at once, so this
 * sends exactly one.
 *
 * The distinction is deliberately not a toggle the person has to understand —
 * an address is detected by the `@`, which is the only rule anybody needs.
 */
export function SignInPage() {
  const { user, signIn } = useAuth();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    const state = location.state as RedirectState | null;
    return <Navigate to={state?.from?.pathname ?? '/'} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const looksLikeEmail = identifier.includes('@');
      await signIn({
        ...(looksLikeEmail
          ? { email: identifier.trim() }
          : { username: identifier.trim() }),
        password,
      });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Use your email address, or the username your manager gave you.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Email or username" htmlFor="identifier">
            <Input
              id="identifier"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="mt-6 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}

/**
 * Turns a failure into something worth reading.
 *
 * Three of these are the server enforcing a rule and its own wording is better
 * than anything invented here: outside working hours names the window, pending
 * verification says what to do next, and the throttler means slow down. The
 * catch-all avoids saying "invalid credentials" for what was actually a dead
 * network, which sends people hunting for a password that was fine.
 */
function messageFor(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (caught.status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (caught.status === 401) {
    return 'That email or username and password do not match.';
  }
  return caught.message;
}
