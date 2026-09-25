import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { Button } from './Button';

/**
 * Opens a server-rendered PDF in a new tab.
 *
 * **A new tab rather than a download**, because the server sends these
 * `inline` on purpose: an invoice here is most often opened on a phone and
 * forwarded over WhatsApp, and a forced download is one more step between the
 * shop and getting paid (DECISIONS.md §6).
 *
 * The object URL is revoked on a timer rather than immediately. Revoking it
 * straight after `window.open` races the new tab's own fetch of the blob and
 * the tab lands on nothing; leaving it forever holds the PDF in memory for the
 * life of the session. A minute is long enough for any tab to load and short
 * enough not to matter.
 */
export function PdfButton({
  path,
  label,
  variant = 'secondary',
}: {
  path: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.document(path);
      const tab = window.open(url, '_blank', 'noopener');
      if (!tab) {
        // Popup blocked. Fall back to a download, which is not blocked, rather
        // than silently doing nothing.
        const link = window.document.createElement('a');
        link.href = url;
        link.download = '';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not build that document.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end">
      <Button variant={variant} onClick={() => void open()} disabled={busy}>
        {busy ? 'Preparing…' : label}
      </Button>
      {error && (
        <span className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
