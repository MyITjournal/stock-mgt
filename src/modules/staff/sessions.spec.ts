import {
  ACTIVE_WINDOW_MS,
  describeDevice,
  isActiveNow,
  issuedBeforeCut,
  summariseSessions,
} from './sessions';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const MAC_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:129.0) Gecko/20100101 Firefox/129.0';

describe('describeDevice', () => {
  it('names the browser and the system', () => {
    expect(describeDevice(ANDROID_CHROME)).toBe('Chrome on Android');
    expect(describeDevice(IPHONE_SAFARI)).toBe('Safari on iPhone');
    expect(describeDevice(MAC_FIREFOX)).toBe('Firefox on Mac');
  });

  it('is not fooled by browsers that also claim to be Chrome or Safari', () => {
    expect(describeDevice(WINDOWS_EDGE)).toBe('Edge on Windows');
    expect(describeDevice(SAMSUNG)).toBe('Samsung Internet on Android');
    expect(describeDevice(IPHONE_CHROME)).toBe('Chrome on iPhone');
  });

  it('says so when it cannot tell', () => {
    expect(describeDevice(null)).toBe('Unknown device');
    expect(describeDevice('curl/8.4.0')).toBe('Unknown device');
    expect(describeDevice('node')).toBe('Unknown device');
  });
});

describe('isActiveNow', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('counts a renewal within the last half hour', () => {
    expect(isActiveNow(new Date(now.getTime() - ACTIVE_WINDOW_MS), now)).toBe(
      true,
    );
  });

  it('does not count one older than that', () => {
    expect(
      isActiveNow(new Date(now.getTime() - ACTIVE_WINDOW_MS - 1000), now),
    ).toBe(false);
  });
});

describe('summariseSessions', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('groups by person and counts people and devices active now', () => {
    const summary = summariseSessions(
      [
        {
          userId: 'owner',
          userAgent: ANDROID_CHROME,
          signedInAt: minutesAgo(120),
          lastActiveAt: minutesAgo(3),
        },
        {
          userId: 'owner',
          userAgent: WINDOWS_EDGE,
          signedInAt: minutesAgo(300),
          lastActiveAt: minutesAgo(10),
        },
        {
          userId: 'amina',
          userAgent: IPHONE_SAFARI,
          signedInAt: minutesAgo(60),
          lastActiveAt: minutesAgo(5),
        },
        // Signed in yesterday and never closed: live, but not active now.
        {
          userId: 'bola',
          userAgent: SAMSUNG,
          signedInAt: minutesAgo(1500),
          lastActiveAt: minutesAgo(1400),
        },
      ],
      new Map(),
      now,
    );

    expect(summary.activePeople).toBe(2);
    expect(summary.activeDevices).toBe(3);
    const owner = summary.members.find((m) => m.userId === 'owner')!;
    expect(owner.sessions.map((s) => s.device)).toEqual([
      'Chrome on Android',
      'Edge on Windows',
    ]);
    const bola = summary.members.find((m) => m.userId === 'bola')!;
    expect(bola.sessions[0].activeNow).toBe(false);
    expect(bola.lastSeenAt).toEqual(minutesAgo(1400));
  });

  it('keeps a row for someone with no live session, so they read as last seen', () => {
    const summary = summariseSessions(
      [],
      new Map([['dave', minutesAgo(600)]]),
      now,
    );
    expect(summary.members).toEqual([
      { userId: 'dave', sessions: [], lastSeenAt: minutesAgo(600) },
    ]);
    expect(summary.activePeople).toBe(0);
  });
});

describe('the sign-out cut', () => {
  const cut = new Date('2026-10-08T10:00:00.750Z');

  it('tells apart two sign-ins in the same second', () => {
    // The first device at .200, the cut at .750, the new one at .800.
    expect(
      issuedBeforeCut({ iat: 1_791_453_600, iatMs: cut.getTime() - 550 }, cut),
    ).toBe(true);
    expect(
      issuedBeforeCut({ iat: 1_791_453_600, iatMs: cut.getTime() + 50 }, cut),
    ).toBe(false);
  });

  it('reads an older token, without iatMs, by its whole second', () => {
    expect(issuedBeforeCut({ iat: cut.getTime() / 1000 - 5 }, cut)).toBe(true);
  });

  it('refuses nothing when nobody was ever signed out', () => {
    expect(issuedBeforeCut({ iatMs: 1 }, null)).toBe(false);
  });
});
