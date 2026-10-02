import { Navigate } from 'react-router-dom';
import { LandingPage } from '../marketing/LandingPage';
import { useAuth, useLandingPath } from './useAuth';

/**
 * The front door at `/`: an explanation for strangers, a doorway for customers.
 *
 * Signed out, it is the landing page — the only screen whose job is to persuade
 * rather than to serve. Signed in, it steps aside immediately: somebody who
 * already has a shop does not want to read about it.
 *
 * **It cannot loop**, and that is a property of `landingPath` rather than of
 * care taken here: no signed-in role resolves to `/`. If one ever did, this
 * would redirect to itself forever, so that rule is load-bearing and is stated
 * where the paths are decided.
 */
export function Home() {
  const { user, loading } = useAuth();
  const landing = useLandingPath();

  // Waiting on the first `GET /auth/me`. Showing the pitch to somebody who
  // turns out to be signed in is a worse flicker than showing nothing briefly.
  if (loading) return null;
  if (user) return <Navigate to={landing} replace />;

  return <LandingPage />;
}

/**
 * Anything that does not know where to send somebody, sending them somewhere
 * they can work.
 *
 * Used by the catch-all route. A URL matching nothing is usually a typo or a
 * stale bookmark; a stranger who hits one lands on the explanation, and a
 * signed-in person lands where their day starts.
 */
export function LandingRedirect() {
  return <Navigate to={useLandingPath()} replace />;
}
