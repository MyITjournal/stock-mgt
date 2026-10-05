import { useState } from 'react';
import { ApiError } from '../api/client';
import { Button } from './Button';

/**
 * "Download" — saves an Excel file of what the screen shows.
 *
 * The work is whatever `onDownload` does, usually `downloadSheet` from
 * `lib/exportSheet.ts`, which loads its writer only when pressed.
 */
export function DownloadButton({
  onDownload,
  label = 'Download',
  disabled = false,
}: {
  onDownload: () => Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDownload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not prepare that file. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant="secondary"
        onClick={() => void run()}
        disabled={busy || disabled}
      >
        {busy ? 'Preparing…' : label}
      </Button>
      {error && (
        <span className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
