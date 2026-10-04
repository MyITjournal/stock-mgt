import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * Reads barcodes through the device camera — for a shop whose only till is a
 * phone.
 *
 * ## Two ways to use it
 *
 * - **Continuous** (the till): stays open, reporting every code it reads,
 *   until the person taps Done. A fifty-item order is fifty scans with the
 *   camera never closing in between.
 * - **Single** (the product form): reports the first code and closes — you
 *   are filling in one barcode box.
 *
 * ## Why the same code is ignored for two seconds
 *
 * The camera sees a barcode many times a second. Without a pause, holding one
 * carton in front of it for a moment would add five. Two seconds is long
 * enough to move the pack away and short enough that scanning the same pack
 * again — five identical cartons — is deliberate and quick.
 *
 * ## Why ZXing, loaded only when opened
 *
 * The browser's own `BarcodeDetector` does not exist on iPhones, and a shop
 * cannot be told to buy Android. ZXing reads the same codes in plain
 * JavaScript everywhere. It is a few hundred kilobytes, so it is fetched the
 * first time a camera is opened rather than with the till — nobody without a
 * camera pays for it.
 *
 * Cameras only open on a secure page: https, or `localhost` while developing.
 */
export function CameraScanner({
  onCode,
  onClose,
  continuous,
  children,
}: {
  /** Called with each code read. Return nothing; errors are the caller's. */
  onCode: (code: string) => void;
  onClose: () => void;
  continuous: boolean;
  /** Shown under the picture — the till puts the line just scanned here. */
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>(
    'starting',
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [lastRead, setLastRead] = useState<string | null>(null);

  // Held in refs so a new `onCode` from a parent re-render does not restart
  // the camera — restarting would blink the picture on every scan.
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCodeRef.current = onCode;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    const recent = { code: '', at: 0 };
    let audio: AudioContext | null = null;

    const feedback = () => {
      navigator.vibrate?.(60);
      try {
        audio ??= new AudioContext();
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.frequency.value = 1_200;
        gain.gain.value = 0.08;
        tone.connect(gain).connect(audio.destination);
        tone.start();
        tone.stop(audio.currentTime + 0.08);
      } catch {
        // A silent scan still worked; sound is a courtesy.
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('failed');
        setProblem(
          'This page cannot use the camera. Cameras only work on a secure (https) address — open Reho from its normal web address.',
        );
        return;
      }
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        if (cancelled) return;

        // Only the shapes printed on goods. Fewer formats to try is a faster,
        // surer read — and a stray QR code on a poster is not a product.
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.ITF,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 100,
        });

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current ?? undefined,
          (result) => {
            if (!result || cancelled) return;
            const code = result.getText();
            const now = Date.now();
            if (code === recent.code && now - recent.at < 2_000) return;
            recent.code = code;
            recent.at = now;

            feedback();
            setLastRead(code);
            onCodeRef.current(code);
            if (!continuous) {
              cancelled = true;
              controls.stop();
              onCloseRef.current();
            }
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        stop = () => controls.stop();
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setStatus('failed');
        setProblem(cameraProblem(caught));
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop?.();
      void audio?.close();
    };
  }, [continuous]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="relative overflow-hidden rounded-md bg-slate-900">
        <video
          ref={videoRef}
          className="block max-h-56 w-full object-cover sm:max-h-72"
          muted
          playsInline
        />
        {/* A guide, not a crop: ZXing reads the whole picture. */}
        {status === 'ready' && (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-16 -translate-y-1/2 rounded border-2 border-white/70" />
        )}
        {status === 'starting' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting the camera…
          </p>
        )}
      </div>

      {problem ? (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
          {problem}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500" aria-live="polite">
          {lastRead
            ? `Read ${lastRead}.${continuous ? ' Point at the next item.' : ''}`
            : 'Point the camera at a barcode and hold it steady.'}
        </p>
      )}

      {children}

      <div className="mt-3 flex justify-end">
        <Button type="button" variant={continuous ? 'primary' : 'secondary'} onClick={onClose}>
          {continuous ? 'Done' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}

/** What went wrong opening the camera, in words a cashier can act on. */
function cameraProblem(caught: unknown): string {
  const name = caught instanceof Error ? caught.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was refused. Allow the camera for this site in your browser settings, then tap the camera button again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is busy — another app may be using it. Close that app and try again.';
    default:
      return 'The camera could not be started. Try again, or type the code instead.';
  }
}
