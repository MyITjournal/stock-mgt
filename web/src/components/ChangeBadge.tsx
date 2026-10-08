/**
 * "▲ 12.5%", "▼ 4.0%" or "▲ 2.5 pts" — a change the server worked out
 * (2026-10-08). Up is green and down is red, each with its arrow, so the
 * direction never rests on colour alone.
 *
 * `null` means there was nothing to compare with — a first month, a month
 * that sold nothing — and says so, rather than reading as "no change".
 */
export function ChangeBadge({
  bps,
  points = false,
}: {
  bps: number | null;
  points?: boolean;
}) {
  if (bps === null) {
    return (
      <span className="text-slate-400" title="Nothing to compare with">
        —
      </span>
    );
  }
  if (bps === 0) return <span className="text-slate-500">no change</span>;

  const up = bps > 0;
  const size = Math.abs(bps / 100).toFixed(1);
  return (
    <span className={up ? 'text-green-700' : 'text-red-600'}>
      {up ? '▲' : '▼'} {points ? `${size} pts` : `${size}%`}
    </span>
  );
}
