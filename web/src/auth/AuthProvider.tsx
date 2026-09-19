import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, setSessionLostHandler } from '../api/client';

/**
 * The roles a person holds inside one business, mirroring `OrgRole` on the
 * server. Duplicated rather than imported because the generated schema types
 * the *wire*, and this is the one enum screens branch on constantly.
 */
export type OrgRole =
  | 'owner'
  | 'manager'
  | 'accountant'
  | 'sales_rep'
  | 'storekeeper';

/** What `GET /auth/me` returns: who is signed in, and where. */
export interface CurrentUser {
  sub: string;
  /** Null for staff who sign in with a username — most cashiers have no email. */
  email: string | null;
  role: string;
  organizationId: string;
  orgRole: OrgRole;
}

export interface AuthState {
  user: CurrentUser | null;
  /** True until the first `GET /auth/me` settles, so guards do not flash. */
  loading: boolean;
  signIn: (credentials: SignInInput) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface SignInInput {
  /** Exactly one of these. The server refuses both or neither. */
  email?: string;
  username?: string;
  password: string;
}

export const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds who is signed in.
 *
 * **There is no token here, on purpose.** The access and refresh tokens are
 * httpOnly cookies the browser attaches on its own; this only tracks *who* the
 * server says they are. That is why signing in is a request whose body is
 * thrown away, and why signing out has to reach the server to revoke the
 * refresh family rather than just clearing state.
 *
 * The session is re-established on load by asking `GET /auth/me`, not by
 * reading anything locally — a cookie this code cannot see is still a valid
 * session, and only the server can say so.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      setUser(await api.get<CurrentUser>('/auth/me'));
    } catch (error) {
      // A 401 here is the ordinary "not signed in" case, not a failure worth
      // surfacing. Anything else is too, from this screen's point of view.
      if (!(error instanceof ApiError)) throw error;
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    // The client calls this when a refresh fails, which is the only way to
    // learn the session died between requests.
    setSessionLostHandler(() => setUser(null));
  }, []);

  const signIn = useCallback(
    async (credentials: SignInInput) => {
      await api.post('/auth/login', credentials);
      // Asked rather than inferred from the login response: the server decides
      // which organization a person lands in when they belong to several.
      await loadSession();
    },
    [loadSession],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      // Cleared even if the request failed. The person asked to leave, and a
      // screen that stays signed in because the network blinked is worse than
      // a refresh token that outlives its welcome by a few minutes.
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
