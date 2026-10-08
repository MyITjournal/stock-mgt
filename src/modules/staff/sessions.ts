/**
 * Who is signed in, worked out from the sign-in records (2026-10-08).
 *
 * Every sign-in starts a chain of refresh tokens, renewed every fifteen minutes
 * while the app is in use, and each one already records the browser that asked
 * for it. Nothing new is collected: this reads what was there.
 *
 * Pure, so the rules are tested without a database.
 */

/**
 * **Signed in now means renewed in the last half hour.** A chain stays valid for
 * days after a phone's browser is closed, so "has a live token" would count
 * people who went home yesterday. The app renews every fifteen minutes while it
 * is used, so somebody working renews at least that often; thirty gives one
 * missed renewal of slack.
 */
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

/** One live chain: its newest token, and when the chain began. */
export interface LiveSession {
  userId: string;
  userAgent: string | null;
  signedInAt: Date;
  lastActiveAt: Date;
}

export interface SessionView {
  device: string;
  signedInAt: Date;
  lastActiveAt: Date;
  activeNow: boolean;
}

export interface MemberSessions {
  userId: string;
  /** Newest first. */
  sessions: SessionView[];
  /** The last renewal on record, signed in now or not; null if none is kept. */
  lastSeenAt: Date | null;
}

export interface SessionsSummary {
  members: MemberSessions[];
  /** People with at least one session active now. */
  activePeople: number;
  /** Sessions active now, across everybody. */
  activeDevices: number;
}

export function isActiveNow(lastActiveAt: Date, now: Date): boolean {
  return now.getTime() - lastActiveAt.getTime() <= ACTIVE_WINDOW_MS;
}

/**
 * "Chrome on Android", from what the browser says about itself.
 *
 * Deliberately small: the owner needs to tell a phone from the shop computer,
 * not a browser's version. Order matters — Edge and Opera and Samsung's browser
 * all claim to be Chrome too, and every iPhone browser claims to be Safari.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;

  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /FxiOS|Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;

  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

/**
 * Groups live sessions by person, adds each person's last renewal, and counts
 * who is active now. A person with no live session still gets a row when a
 * last-seen time is known, so the screen can say when they were last on.
 */
export function summariseSessions(
  live: readonly LiveSession[],
  lastSeen: ReadonlyMap<string, Date>,
  now: Date,
): SessionsSummary {
  const byUser = new Map<string, MemberSessions>();
  const rowFor = (userId: string) => {
    let row = byUser.get(userId);
    if (!row) {
      row = { userId, sessions: [], lastSeenAt: lastSeen.get(userId) ?? null };
      byUser.set(userId, row);
    }
    return row;
  };

  for (const userId of lastSeen.keys()) rowFor(userId);

  let activeDevices = 0;
  for (const session of live) {
    const activeNow = isActiveNow(session.lastActiveAt, now);
    if (activeNow) activeDevices += 1;
    const row = rowFor(session.userId);
    row.sessions.push({
      device: describeDevice(session.userAgent),
      signedInAt: session.signedInAt,
      lastActiveAt: session.lastActiveAt,
      activeNow,
    });
    if (!row.lastSeenAt || session.lastActiveAt > row.lastSeenAt) {
      row.lastSeenAt = session.lastActiveAt;
    }
  }

  const members = [...byUser.values()];
  for (const row of members) {
    row.sessions.sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  }

  return {
    members,
    activePeople: members.filter((row) => row.sessions.some((s) => s.activeNow))
      .length,
    activeDevices,
  };
}

/**
 * Whether an access token was issued before its sessions were ended.
 *
 * Read from `iatMs`, the issue time to the millisecond that `TokenService`
 * puts in every token: the standard `iat` is whole seconds, and two sign-ins
 * in the same second would otherwise be indistinguishable. A token from before
 * `iatMs` existed falls back to `iat`, which can only make it look older —
 * the safe direction for a token being refused.
 */
export function issuedBeforeCut(
  token: { iat?: number; iatMs?: number },
  sessionsEndedAt: Date | null,
): boolean {
  if (!sessionsEndedAt) return false;
  const issuedAt =
    token.iatMs ?? (token.iat === undefined ? undefined : token.iat * 1000);
  if (issuedAt === undefined) return false;
  return issuedAt < sessionsEndedAt.getTime();
}
