import { useState } from 'react';
import { useShopCurrency } from '../lib/shopCurrency';
import { formatMoney } from '../lib/money';

export interface MonthBar {
  key: string;
  label: string;
  /** Minor units, as the server sent them. */
  value: number;
  /** This month, so far: drawn lighter and labelled, so it is not misread. */
  partial: boolean;
}

/**
 * One money figure, one column per month (2026-10-08, Reports → Growth).
 *
 * A single series, so no legend — the title names it. Columns are capped at
 * 24px with a rounded top and a square foot on the baseline; the month still
 * under way is lighter with a dashed edge and says "so far", because a
 * half-month column beside full ones reads as a fall. Only the newest column
 * carries its value; hovering any column shows its own. Values the server
 * sent are drawn, never worked out here — the scale is the only arithmetic.
 *
 * Revenue and gross profit are **two charts, never one with two scales**:
 * on a 3% margin, gross profit on revenue's scale is a row of slivers.
 */
export function MonthBars({
  title,
  bars,
}: {
  title: string;
  bars: readonly MonthBar[];
}) {
  const currency = useShopCurrency();
  const [hovered, setHovered] = useState<number | null>(null);

  const high = Math.max(0, ...bars.map((bar) => bar.value));
  const low = Math.min(0, ...bars.map((bar) => bar.value));
  const step = niceStep((high - low) / 3 || 1);
  const top = Math.ceil(high / step) * step || step;
  const bottom = Math.floor(low / step) * step;
  const span = top - bottom;
  const ticks: number[] = [];
  for (let tick = bottom; tick <= top + step / 2; tick += step) {
    ticks.push(tick);
  }
  // Where zero sits, as a share of the plot's height from the top.
  const zeroAt = top / span;
  const short = (minor: number) => compactMoney(minor, currency);

  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 text-sm font-semibold text-slate-900">
        {title}
      </figcaption>
      <div className="flex gap-2">
        {/* The scale: a few round figures, recessive. */}
        <div className="relative h-44 w-14 shrink-0 text-right text-[11px] text-slate-400">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${((top - tick) / span) * 100}%` }}
            >
              {short(tick)}
            </span>
          ))}
        </div>

        <div className="relative h-44 flex-1">
          {ticks.map((tick) => (
            <div
              key={tick}
              className={`absolute inset-x-0 border-t ${
                tick === 0 ? 'border-slate-300' : 'border-slate-100'
              }`}
              style={{ top: `${((top - tick) / span) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex">
            {bars.map((bar, index) => {
              const size = (Math.abs(bar.value) / span) * 100;
              const up = bar.value >= 0;
              const newest = index === bars.length - 1;
              return (
                <div
                  key={bar.key}
                  className="relative flex-1"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  aria-label={`${bar.label}${bar.partial ? ', so far' : ''}: ${formatMoney(bar.value, currency)}`}
                >
                  <div
                    className={`absolute left-1/2 w-full max-w-6 -translate-x-1/2 ${
                      up ? 'rounded-t' : 'rounded-b'
                    } ${
                      bar.partial
                        ? 'border border-dashed border-[#2a78d6] bg-[#2a78d6]/40'
                        : 'bg-[#2a78d6]'
                    } ${hovered === index ? 'opacity-80' : ''}`}
                    style={
                      up
                        ? {
                            bottom: `${(1 - zeroAt) * 100}%`,
                            height: `${size}%`,
                          }
                        : { top: `${zeroAt * 100}%`, height: `${size}%` }
                    }
                  />
                  {newest && hovered === null && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1 text-[11px] font-medium text-slate-700"
                      style={{
                        top: `${(up ? zeroAt - size / 100 : zeroAt) * 100}%`,
                      }}
                    >
                      {short(bar.value)}
                    </span>
                  )}
                  {hovered === index && (
                    <span
                      className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
                      role="tooltip"
                    >
                      {bar.label}
                      {bar.partial ? ' (so far)' : ''}:{' '}
                      {formatMoney(bar.value, currency)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Month names under their columns, offset by the scale's width. */}
      <div className="mt-1 flex gap-2">
        <div className="w-14 shrink-0" />
        <div className="flex flex-1">
          {bars.map((bar) => (
            <span
              key={bar.key}
              className="flex-1 text-center text-[11px] leading-tight text-slate-500"
            >
              {bar.label.split(' ')[0]}
              {bar.partial && (
                <span className="block text-slate-400">so far</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/** A round step for the scale: 1, 2 or 5 times a power of ten. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

/** "₦1.2M" — the scale's labels, from minor units. */
function compactMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 100);
}
