import type { paths } from './schema';

/**
 * The one way this application talks to the API.
 *
 * Three things it takes care of so no screen has to think about them:
 *
 * - **Cookies, always.** Auth is httpOnly `access_token` and `refresh_token`
 *   cookies set by the server (DECISIONS.md §17). Nothing here reads or writes
 *   a token, and nothing puts one in `localStorage` — that is the whole point
 *   of the cookies being httpOnly.
 * - **One refresh, shared.** A 401 triggers `POST /auth/refresh` once and the
 *   original request is retried. Concurrent 401s wait on the same refresh
 *   rather than each starting their own, which would rotate the token family
 *   several times over and trip the server's reuse detection — that revokes the
 *   whole family and logs the person out, which is precisely what a refresh is
 *   meant to prevent.
 * - **An idempotency key on every write.** The server replays the stored
 *   response for a repeated key instead of doing the work twice. On a till a
 *   double-click is a double sale, so this is not optional.
 */

const BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:4000/api/v1';

/** Where `POST /auth/refresh` lives, relative to the base. */
const REFRESH_PATH = '/auth/refresh';

/** Methods that change something and therefore carry an idempotency key. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * A failed request, carrying enough for a screen to say something useful.
 *
 * `status` is the part worth branching on: a 409 from this API is almost always
 * a rule being enforced with a message written for a person — not enough stock,
 * this customer still owes, that key was used for a different request — and
 * showing `message` verbatim is usually the right thing.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** The session is gone and refreshing did not help. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Signed in, but this role may not do this. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** A rule was enforced. `message` is written to be shown. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Reuse a key across retries of the *same* logical write, never across two. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Internal: stops a retried request from retrying again. */
  retrying?: boolean;
}

/** Set when a refresh is in flight, so concurrent 401s wait on one attempt. */
let refreshInFlight: Promise<boolean> | null = null;

/** Called when refreshing fails, so the app can send someone back to sign in. */
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

async function attemptRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}${REFRESH_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // The refresh token is read from its cookie; the body is the fallback
        // for clients that cannot hold one, and this is not that.
        body: '{}',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all observe
      // the same result before another attempt can begin.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

async function parseBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 204) return null;
  if (type.includes('application/json')) {
    return (await response.json()) as unknown;
  }
  return await response.text();
}

function errorFrom(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object') {
    const shape = body as { message?: unknown; error?: unknown };
    // Nest sends `message` as a string or, from the validation pipe, an array
    // of them. Joining keeps every complaint rather than only the first.
    const message = Array.isArray(shape.message)
      ? shape.message.join('\n')
      : typeof shape.message === 'string'
        ? shape.message
        : undefined;
    const code = typeof shape.error === 'string' ? shape.error : undefined;
    if (message) return new ApiError(status, message, code, body);
  }
  return new ApiError(status, `Request failed (${status})`, undefined, body);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (WRITE_METHODS.has(method)) {
    headers['Idempotency-Key'] = options.idempotencyKey ?? crypto.randomUUID();
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && !options.retrying && path !== REFRESH_PATH) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      // Deliberately reuses `idempotencyKey` when the caller gave one: this is
      // the same logical write, and the server should replay rather than repeat
      // it if the first attempt actually landed.
      return request<T>(path, { ...options, retrying: true });
    }
    onSessionLost?.();
  }

  const body = await parseBody(response);
  if (!response.ok) throw errorFrom(response.status, body);
  return body as T;
}

/**
 * Fetches a binary document — a PDF — through the same session handling as
 * everything else.
 *
 * **Why not just link to it.** `<a href="{API}/sales/:id/invoice.pdf">` looks
 * simpler and is subtly broken: a raw navigation cannot run the refresh above,
 * so once the 15-minute access token expires the shop gets a JSON 401 where an
 * invoice should be — intermittently, and looking like the server is faulty.
 * Going through here means an expired session refreshes once, shared with every
 * other in-flight request, and the document opens.
 *
 * The caller gets an object URL to open or download, and **must revoke it**:
 * the blob is held in memory until it does.
 */
async function document(path: string): Promise<{ url: string; name: string }> {
  const fetchOnce = (retrying: boolean) =>
    fetch(`${BASE_URL}${path}`, { method: 'GET', credentials: 'include' }).then(
      async (response) => {
        if (response.status === 401 && !retrying) return null;
        if (!response.ok) {
          throw errorFrom(response.status, await parseBody(response));
        }
        return response;
      },
    );

  let response = await fetchOnce(false);
  if (!response) {
    const refreshed = await attemptRefresh();
    if (!refreshed) {
      onSessionLost?.();
      throw new ApiError(401, 'Your session has expired. Sign in again.');
    }
    response = await fetchOnce(true);
    if (!response) throw new ApiError(401, 'Your session has expired.');
  }

  // The server sends `inline` with a filename, because these get opened on a
  // phone and forwarded over WhatsApp rather than filed.
  const disposition = response.headers.get('content-disposition') ?? '';
  const matched = /filename="?([^";]+)"?/.exec(disposition);

  return {
    url: URL.createObjectURL(await response.blob()),
    name: matched?.[1] ?? path.split('/').pop() ?? 'document.pdf',
  };
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', signal }),

  document,

  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),

  patch: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'PATCH', body, idempotencyKey }),

  delete: <T>(path: string, idempotencyKey?: string) =>
    request<T>(path, { method: 'DELETE', idempotencyKey }),
};

/**
 * The response type of an endpoint, read out of the generated schema.
 *
 * ```ts
 * type Dashboard = ApiResponse<'/api/v1/reports/dashboard'>;
 * ```
 *
 * Generated from the live OpenAPI document, so a screen cannot drift from the
 * contract without the build saying so — which is the reason these types are
 * generated rather than hand-written, and the reason nothing here imports from
 * Prisma (§17).
 */
export type ApiResponse<
  P extends keyof paths,
  M extends keyof paths[P] = 'get' extends keyof paths[P] ? 'get' : never,
> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer R } } };
}
  ? R
  : paths[P][M] extends {
        responses: { 201: { content: { 'application/json': infer R } } };
      }
    ? R
    : unknown;
