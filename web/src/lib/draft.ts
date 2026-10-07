import { useEffect, useState } from 'react';

/**
 * Work kept in this browser until it is saved (2026-10-07).
 *
 * The owner lost one invoice twice to a server error and had to type it again
 * each time. A long form is now copied to `localStorage` as it is filled in
 * and handed back when the screen opens again — after a failed save, a
 * refresh, a closed tab — and thrown away the moment the server accepts it.
 *
 * **This browser only, and only a convenience.** It never reaches the server or
 * another device, it can be empty (private windows, cleared site data) and
 * every read and write is wrapped so a browser that refuses storage just
 * behaves as before. Keyed by shop, so two shops on one computer keep their own.
 */
const PREFIX = 'reho.draft.';

/** A kept draft and when it was last written. */
export interface Kept<T> {
  value: T;
  savedAt: string;
}

export function readDraft<T>(key: string): Kept<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Kept<T>;
    return parsed && typeof parsed === 'object' && 'value' in parsed
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T): void {
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ value, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Storage full or refused: the form still works, it just is not kept.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to do.
  }
}

/**
 * Reads the draft once, when the screen opens. Returns it with a `dismiss`
 * for the "brought back" notice, so the screen can say what happened.
 */
export function useRestoredDraft<T>(key: string | null) {
  const [restored] = useState(() => (key ? readDraft<T>(key) : null));
  const [noticeOpen, setNoticeOpen] = useState(restored !== null);
  return {
    restored,
    noticeOpen,
    dismiss: () => setNoticeOpen(false),
  };
}

/**
 * Keeps `value` under `key` while `keep` is true, and clears it when `keep`
 * turns false — an empty form is not worth bringing back.
 */
export function useKeepDraft<T>(key: string | null, value: T, keep: boolean) {
  const serialised = JSON.stringify(value);
  useEffect(() => {
    if (!key) return;
    if (keep) writeDraft(key, JSON.parse(serialised) as T);
    else clearDraft(key);
  }, [key, serialised, keep]);
}

/** "14:05" today, or "6 Oct, 14:05" on another day. */
export function keptAt(savedAt: string): string {
  const at = new Date(savedAt);
  const sameDay = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return sameDay
    ? time
    : `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
}
