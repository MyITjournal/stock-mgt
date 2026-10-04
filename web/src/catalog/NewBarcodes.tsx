import { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Field';
import { CameraScanner } from '../components/CameraScanner';

/**
 * The barcodes of a product being added — scanned straight off the pack as
 * part of adding it, with no separate step.
 *
 * Every pack already carries its code, so the moment somebody is holding it
 * to type the name is the moment to scan it. One box per unit, because a
 * carton usually carries a code of its own (often an ITF-14 on the box) that
 * is not the code on the single item inside it.
 *
 * Nothing here writes. The codes ride along in the `barcodes` array of the
 * same `POST /products`, keyed by unit name like prices are (§4), and the
 * server checks every check digit before anything is saved. A blank box is
 * simply no code; a product that needs an in-house code gets one from the
 * Barcodes section once it is saved.
 */
export function NewBarcodes({
  units,
  codes,
  onChange,
}: {
  units: readonly { key: string; name: string }[];
  codes: Readonly<Record<string, string>>;
  onChange: (unitKey: string, code: string) => void;
}) {
  const [scanning, setScanning] = useState<string | null>(null);
  const named = units.filter((unit) => unit.name.trim());

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-slate-900">Barcodes</h3>
      <p className="mt-1 text-xs text-slate-500">
        Scan the code printed on each pack, or type it. A carton often has a
        code of its own. Leave a box empty if that unit has none.
      </p>

      <div className="mt-3 space-y-2">
        {named.map((unit) => (
          <div key={unit.key}>
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-sm text-slate-700">
                {unit.name}
              </span>
              <Input
                aria-label={`Barcode on the ${unit.name}`}
                value={codes[unit.key] ?? ''}
                onChange={(event) => onChange(unit.key, event.target.value)}
                inputMode="numeric"
                placeholder="Scan or type"
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setScanning(unit.key)}
                disabled={scanning !== null}
                aria-label={`Scan the ${unit.name} barcode with the camera`}
              >
                Camera
              </Button>
            </div>
            {scanning === unit.key && (
              <div className="mt-2">
                <CameraScanner
                  continuous={false}
                  onCode={(code) => onChange(unit.key, code)}
                  onClose={() => setScanning(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
