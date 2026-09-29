import { Navigate } from 'react-router-dom';
import { HomePage } from '../home/HomePage';
import { useLandingPath } from './useAuth';

/**
 * The index route, which is the dashboard for some roles and a redirect for
 * the rest.
 *
 * The check is a comparison against {@link useLandingPath} rather than a
 * second reading of the role, so there is exactly one rule and no way for the
 * two to disagree. When the landing path *is* `/` there is nothing to redirect
 * to and the dashboard renders — which also means this can never loop.
 */
export function Home() {
  const landing = useLandingPath();
  return landing === '/' ? <HomePage /> : <Navigate to={landing} replace />;
}

/**
 * Anything that does not know where to send somebody, sending them somewhere
 * they can work.
 *
 * Used by the catch-all route. A URL that matches nothing is usually a typo or
 * a stale bookmark, and dumping it on a screen the person's role cannot read
 * turns a small mistake into a dead end.
 */
export function LandingRedirect() {
  return <Navigate to={useLandingPath()} replace />;
}
