import type { components } from '../api/schema';

type MemberSessions = components['schemas']['MemberSessionsView'];

/**
 * One person's line on Staff: signed in now, on what and since when — or when
 * they were last on (2026-10-08).
 *
 * "Active" comes from the server (renewed in the last thirty minutes); the
 * browser only words the times. A session that is still valid but has not
 * been used in half an hour is not "signed in" here: a phone left with the
 * browser closed would otherwise read as somebody at work.
 */
export function SignedInLine({
  member,
  now = new Date(),
}: {
  member: MemberSessions | undefined;
  now?: Date;
}) {
  const active = member?.sessions.filter((session) => session.activeNow) ?? [];

  if (active.length === 0) {
    return (
      <p className="mt-1 text-xs text-slate-500">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-300 align-middle" />
        Not signed in now
        {member?.lastSeenAt && <> · last seen {seen(member.lastSeenAt, now)}</>}
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-0.5 text-xs text-slate-600">
      {active.map((session) => (
        <p key={`${session.device}-${session.signedInAt}`}>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
          Signed in · {session.device} · since {clock(session.signedInAt, now)}{' '}
          · active {ago(session.lastActiveAt, now)}
        </p>
      ))}
    </div>
  );
}

/** "8:12 am", or "yesterday, 6:40 pm", or "Mon 6 Oct, 6:40 pm". */
function clock(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (at.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) {
    return `yesterday, ${time}`;
  }
  const day = at.toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${day}, ${time}`;
}

/** "just now", "4 min ago", "2 h ago". */
function ago(iso: string, now: Date): string {
  const minutes = Math.round(
    (now.getTime() - new Date(iso).getTime()) / 60_000,
  );
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function seen(iso: string, now: Date): string {
  const minutes = (now.getTime() - new Date(iso).getTime()) / 60_000;
  return minutes < 60 ? ago(iso, now) : clock(iso, now);
}
