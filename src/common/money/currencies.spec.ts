import { isTimezone, startingTimezone } from './currencies';

describe('startingTimezone', () => {
  it('uses the owner’s own zone when the browser sent one', () => {
    // A Lagos importer pricing in dollars is still on Lagos time.
    expect(startingTimezone('USD', 'Africa/Lagos')).toBe('Africa/Lagos');
  });

  it('falls back to the currency’s home zone', () => {
    expect(startingTimezone('GHS')).toBe('Africa/Accra');
    expect(startingTimezone('KES')).toBe('Africa/Nairobi');
    expect(startingTimezone('NGN')).toBe('Africa/Lagos');
  });

  it('ignores a zone the server cannot resolve', () => {
    expect(startingTimezone('GBP', 'Mars/Olympus')).toBe('Europe/London');
  });
});

describe('isTimezone', () => {
  it('knows a real zone from a made-up one', () => {
    expect(isTimezone('Africa/Nairobi')).toBe(true);
    expect(isTimezone('Lagos')).toBe(false);
  });
});
