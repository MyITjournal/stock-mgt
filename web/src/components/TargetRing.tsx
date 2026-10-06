import type { ReactNode } from 'react';
import { formatCartons } from '../lib/quantity';
import { Money } from './Money';

/**
 * One vendor target as a ring: how much of the month's target has arrived.
 *
 * A single ratio against a limit, so this is a **meter bent into a circle**,
 * not a two-slice pie: the filled arc is the brand colour, and the unfilled
 * track is a lighter step of the same green so the whole ring reads as one
 * scale. The percentage sits in the middle and the figures are written
 * underneath — the number never depends on colour to be read, and "met" is
 * said in words, not by a change of hue.
 *
 * Over the target, the ring is full and says so. A percentage above 100 is a
 * real figure — a vendor scheme often pays on over-performance — so it is
 * shown, while the arc simply stops at full.
 *
 * Two kinds share the one ring: cartons of a category (`TargetRing`) and a
 * vendor's month in money (`MoneyTargetRing`).
 */
function Ring({
  achievedBps,
  summary,
  title,
  subtitle,
  progress,
  toGo,
}: {
  achievedBps: number;
  summary: string;
  title: string;
  subtitle: string;
  progress: ReactNode;
  toGo: ReactNode;
}) {
  const size = 112;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = Math.min(achievedBps / 10_000, 1);
  const met = achievedBps >= 10_000;
  const percent = Math.round(achievedBps / 100);

  return (
    <figure
      className="flex flex-col items-center rounded-lg border border-slate-200 bg-white p-4 text-center"
      title={summary}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={summary}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-brand-100"
          strokeWidth={stroke}
        />
        {share > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-brand-600"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${share * circumference} ${circumference}`}
            // Starts at twelve o'clock and fills clockwise, like a clock face.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-slate-900 text-xl font-semibold"
        >
          {percent}%
        </text>
      </svg>

      <figcaption className="mt-3">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
        <div className="mt-1 text-xs text-slate-700">{progress}</div>
        <div
          className={`mt-0.5 text-xs ${met ? 'font-medium text-brand-700' : 'text-slate-500'}`}
        >
          {met ? (achievedBps > 10_000 ? 'Over target' : 'Target met') : toGo}
        </div>
      </figcaption>
    </figure>
  );
}

/** Cartons of a category from one vendor. */
export function TargetRing({
  category,
  supplier,
  targetCartons,
  achievedCartons,
  remainingCartons,
  achievedBps,
}: {
  category: string;
  supplier: string;
  targetCartons: number;
  achievedCartons: number;
  remainingCartons: number;
  achievedBps: number;
}) {
  const percent = Math.round(achievedBps / 100);
  return (
    <Ring
      achievedBps={achievedBps}
      summary={`${category} from ${supplier}: ${formatCartons(achievedCartons)} of ${formatCartons(targetCartons)} cartons, ${percent}%`}
      title={category}
      subtitle={supplier}
      progress={`${formatCartons(achievedCartons)} of ${formatCartons(targetCartons)} cartons`}
      toGo={`${formatCartons(remainingCartons)} to go`}
    />
  );
}

/**
 * A vendor's month in money. The figures are the server's — `counted` already
 * has VAT taken off when the vendor adds it — so nothing is worked out here.
 */
export function MoneyTargetRing({
  supplier,
  amount,
  addsVat,
  counted,
  remaining,
  achievedBps,
}: {
  supplier: string;
  amount: number;
  addsVat: boolean;
  counted: number;
  remaining: number;
  achievedBps: number;
}) {
  const percent = Math.round(achievedBps / 100);
  return (
    <Ring
      achievedBps={achievedBps}
      summary={`${supplier}, money target: ${percent}%${addsVat ? ', before VAT' : ''}`}
      title={supplier}
      subtitle={addsVat ? 'Money target, before VAT' : 'Money target'}
      progress={
        <>
          <Money value={counted} /> of <Money value={amount} />
        </>
      }
      toGo={
        <>
          <Money value={remaining} /> to go
        </>
      }
    />
  );
}
