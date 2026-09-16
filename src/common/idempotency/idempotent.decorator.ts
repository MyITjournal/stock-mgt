import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** The header as Swagger should display it; the interceptor matches it case-insensitively. */
const HEADER_NAME = 'Idempotency-Key';

/**
 * Marks a write replayable: the caller may send an `Idempotency-Key`, and a
 * retry carrying the same key gets the first outcome back instead of doing the
 * work twice.
 *
 * Applied per route rather than globally, deliberately. Most POSTs here are
 * *creates*, where a replay is exactly right; a few are *commands* — void,
 * cancel — which take no body, so their request hash is a constant and the
 * endpoint is matched on the route pattern rather than the concrete id. A key
 * reused across two of those would replay the first answer and silently do
 * nothing. Binding this globally would hand that behaviour to every command
 * route by default, so each one opts in instead.
 *
 * `description` says which duplicate is being prevented, in the language of the
 * business rather than the mechanism: it is what a client author reads in
 * Swagger when deciding whether they need a key at all.
 */
export function Idempotent(description: string) {
  return applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({ name: HEADER_NAME, required: false, description }),
  );
}
