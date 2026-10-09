import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { Button } from './Button';

/**
 * Prints a server-rendered PDF — the invoice — without the person having to
 * open it first.
 *
 * ## How
 *
 * The PDF is fetched through `api.document`, never a plain link, so an expired
 * session refreshes instead of printing a JSON 401 (§17). On a computer it is
 * loaded into a hidden frame and that frame's print dialog opened: one click,
 * straight to the printer or "Save as PDF".
 *
 * ## Why a phone opens it instead
 *
 * Phone browsers do not reliably print a PDF from a hidden frame — Android
 * Chrome ignores the request, iOS Safari prints the page around it. So on a
 * touch screen the invoice opens in the phone's own viewer, which has Print
 * and Share built in. It is one more tap, and it is the tap that works.
 *
 * The object URL is revoked on a timer, for the same reason as `PdfButton`:
 * revoking at once races the frame's own load of the blob.
 *
 * ## Every copy is counted (2026-10-09)
 *
 * The server counts the copy as it builds the PDF; `purpose=print` only tells
 * the owner, in the sale's history, that it came from a Print button. It is a
 * write, so it ends with `afterWrite` and the sale on screen shows the count.
 */
export function PrintButton({
  path,
  label = 'Print',
  variant = 'secondary',
  fullWidth = false,
}: {
  path: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Stretch across its container — the till's receipt, on a phone. */
  fullWidth?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const print = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.document(
        `${path}${path.includes('?') ? '&' : '?'}purpose=print`,
      );
      afterWrite(queryClient);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

      if (window.matchMedia('(pointer: coarse)').matches) {
        if (!window.open(url, '_blank', 'noopener')) {
          setError('Allow pop-ups for this site to print from a phone.');
        }
        return;
      }

      const frame = window.document.createElement('iframe');
      frame.style.position = 'fixed';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      frame.setAttribute('aria-hidden', 'true');
      frame.src = url;
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          // A browser that will not print the frame still shows the invoice.
          window.open(url, '_blank', 'noopener');
        }
        // Long enough for the dialog to have taken its copy of the document.
        window.setTimeout(() => frame.remove(), 60_000);
      };
      window.document.body.appendChild(frame);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not prepare that for printing.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={fullWidth ? 'flex flex-col' : 'inline-flex flex-col items-end'}
    >
      <Button
        variant={variant}
        onClick={() => void print()}
        disabled={busy}
        className={fullWidth ? 'h-12 w-full text-base' : undefined}
      >
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
