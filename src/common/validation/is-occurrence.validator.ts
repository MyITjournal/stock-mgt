import { applyDecorators } from '@nestjs/common';
import { Validate, ValidatorConstraint } from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * How far ahead of the server an event may claim to have happened.
 *
 * A day, which is clock skew and timezone confusion rather than a real event.
 * Nothing in this product happens in the future: a sale is recorded after it is
 * made, and an offline device syncing late still sends a past timestamp.
 */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/**
 * How far back one may reach.
 *
 * A year. The point is not to stop a business entering last month's expense —
 * that is ordinary and allowed — but to stop a timestamp that is simply wrong,
 * whether from a device with a dead clock battery reporting 1970 or from
 * somebody moving a figure somewhere nobody looks.
 */
const MAX_PAST_MS = 365 * 24 * 60 * 60 * 1000;

@ValidatorConstraint({ name: 'plausibleOccurrence', async: false })
class PlausibleOccurrence implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string') return false;

    const at = new Date(value).getTime();
    if (Number.isNaN(at)) return false;

    const now = Date.now();
    return at <= now + MAX_FUTURE_MS && at >= now - MAX_PAST_MS;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a real date: no more than a day ahead of now, and not more than a year ago. An offline device sends its own clock, so check that clock.`;
  }
}

/**
 * Bounds a client-supplied "when this happened" to a date that could be real.
 *
 * These timestamps are client-supplied on purpose and have to stay that way —
 * §8, a rep offline at 9am syncing at 5pm — but they were entirely unbounded,
 * and every report in §12 filters on them. A sale dated 2087 sits outside every
 * window forever; one dated 1970 quietly leaves the month it belonged to. The
 * server's own `createdAt` still records when the row actually arrived, so a
 * date moved *within* this window stays auditable by comparing the two.
 *
 * Deliberately only the bound, so each DTO keeps its own Swagger description of
 * what its particular event means.
 */
export function IsPlausibleOccurrence(): PropertyDecorator {
  return applyDecorators(Validate(PlausibleOccurrence));
}
