import { Logger } from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import * as readline from 'node:readline';
import { AppModule } from '../app.module';
import { AuthService } from '../modules/auth/auth.service';
import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../common/money/currencies';

/**
 * The operator's way in, for an instance where nobody can sign themselves up.
 *
 * `SELF_SERVE_SIGNUP=false` closes `register`, `resend-otp` and
 * `forgot-password` (see `self-serve.ts`), which is what allows production to
 * run with no mail provider. The two jobs those endpoints used to do still have
 * to be possible, so they live here instead — behind the database rather than
 * behind a URL.
 *
 * ## Why a Nest context rather than a standalone Prisma script
 *
 * `createApplicationContext` boots the real modules without listening on a
 * port, so this calls the same `AuthService` the app does. A script talking to
 * Prisma directly would have to re-implement organization seeding, and the copy
 * would drift — which is exactly how businesses ended up with no default price
 * tier once before.
 *
 * ## Usage
 *
 *   node dist/cli/admin create-org --org "Adebayo Stores" \
 *     --first Ade --last Bayo --email owner@example.com
 *
 *   node dist/cli/admin create-org --org "Corner Shop" \
 *     --first Amina --last Bello --username amina
 *
 *   node dist/cli/admin create-org --org "Bello Distributors" \
 *     --first Musa --last Bello --username musa --type wholesale
 *
 * `--type` is retail, wholesale or mixed, and defaults to mixed. `--currency` is
 * NGN, USD, GBP, EUR, GHS or KES, and defaults to NGN; the time zone follows it.
 *
 *   node dist/cli/admin set-password --email owner@example.com
 *   node dist/cli/admin set-password --username amina@corner-shop-a1b2c3
 *
 * The password is always prompted for, never taken as a flag: an argument ends
 * up in shell history and in the process list, where anybody on the box can
 * read it.
 */

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args.set(token.slice(2), 'true');
    } else {
      args.set(token.slice(2), next);
      i += 1;
    }
  }
  return args;
}

/**
 * Reads a password without echoing it.
 *
 * `readline` has no hidden-input mode, so this mutes the output stream while
 * the answer is typed. If stdin is not a TTY — a pipe, a CI step — the muting
 * is pointless but harmless, and the read still works.
 */
type MutableInterface = readline.Interface & {
  /**
   * Undocumented, and the only hook readline offers for this. Typed here
   * rather than cast at the call site so the override below is checked like
   * any other assignment.
   */
  _writeToOutput?: (text: string) => void;
};

/**
 * Terminal mode only when there is a terminal.
 *
 * Forcing `terminal: true` over a pipe makes `question` wait for input in a
 * shape that never arrives, and the process hangs with no output. Piped input
 * also has nothing to hide: the characters were never echoed in the first
 * place.
 */
const interactive = process.stdin.isTTY === true;

/**
 * One interface for the whole run, opened on first use.
 *
 * **Not one per prompt.** A readline interface buffers whatever is available on
 * `process.stdin`, so closing the first one after a single answer discards the
 * rest.
 */
let session: MutableInterface | null = null;

function ask(): MutableInterface {
  session ??= readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  }) as MutableInterface;
  return session;
}

function closeSession(): void {
  session?.close();
  session = null;
}

/**
 * Every line of piped input, read once, before anything asks for one.
 *
 * ## Why piped input cannot go through readline
 *
 * A pipe usually delivers the whole payload in a single chunk, and readline
 * turns that chunk into all of its `line` events **synchronously**. Resolving a
 * promise is a microtask, so by the time the first answer has been handed back
 * and the second `question()` registered, the second line has already been
 * emitted and dropped — and the command hangs forever waiting for input that
 * was delivered before it was listening.
 *
 * Draining the stream first removes the race rather than timing around it. A
 * terminal is the opposite case — input arrives as somebody types it, there is
 * no EOF to wait for, and echoing has to be suppressed — so the two modes share
 * nothing but the function signature.
 */
let piped: string[] | null = null;

async function drainStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
}

async function prompt(question: string, hidden = false): Promise<string> {
  if (!interactive) {
    piped ??= await drainStdin();
    const answer = piped.shift();
    if (answer === undefined) {
      throw new Error(
        `Ran out of piped input at "${question.trim()}". Non-interactive runs need one line per prompt.`,
      );
    }
    // Echo the question so a transcript still reads sensibly. The answer is
    // never echoed, hidden or not — it was never on screen to begin with.
    process.stdout.write(`${question}\n`);
    return answer.trim();
  }

  const rl = ask();

  return new Promise((resolve) => {
    const original = rl._writeToOutput;

    if (hidden) {
      rl._writeToOutput = (text: string) => {
        // Let the question itself through, swallow the typed characters.
        if (text.includes(question)) original?.call(rl, text);
      };
    }

    rl.question(question, (answer) => {
      // Restore echoing, or every later prompt inherits the muting.
      if (hidden) {
        rl._writeToOutput = original;
        process.stdout.write('\n');
      }
      resolve(answer.trim());
    });
  });
}

async function readNewPassword(): Promise<string> {
  const first = await prompt('New password: ', true);
  if (first.length < 8) {
    throw new Error('A password needs at least 8 characters.');
  }
  const second = await prompt('Again: ', true);
  if (first !== second) throw new Error('Those did not match.');
  return first;
}

async function createOrg(auth: AuthService, args: Map<string, string>) {
  const organizationName = args.get('org');
  const firstName = args.get('first');
  const lastName = args.get('last');
  const email = args.get('email');
  const username = args.get('username');
  const type = args.get('type') ?? BusinessType.mixed;
  const currency = (args.get('currency') ?? DEFAULT_CURRENCY).toUpperCase();

  if (!organizationName || !firstName || !lastName) {
    throw new Error(
      'create-org needs --org, --first and --last, plus --email or --username.',
    );
  }
  if (!email && !username) {
    throw new Error('Give the owner an --email or a --username.');
  }
  // Checked before the password prompt, so a typo costs nothing to retype.
  if (!(Object.values(BusinessType) as string[]).includes(type)) {
    throw new Error('--type must be retail, wholesale or mixed.');
  }
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    throw new Error(
      `--currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }

  const password = await readNewPassword();

  const result = await auth.createVerifiedOwner({
    organizationName,
    firstName,
    lastName,
    password,
    email,
    username,
    businessType: type as BusinessType,
    currency: currency as SupportedCurrency,
  });

  process.stdout.write(
    [
      '',
      `Created "${result.organizationName}".`,
      `  organization  ${result.organizationId}`,
      `  slug          ${result.organizationSlug}`,
      `  trades as     ${type}`,
      `  currency      ${currency}`,
      `  owner         ${result.userId}`,
      `  signs in with ${result.email ?? result.username ?? '(none)'}`,
      '',
      'Tell them the password you just set. They can change it themselves from',
      'the dashboard — POST /auth/change-password — which is the only way they',
      'can, because password reset by email is off on this instance.',
      '',
    ].join('\n'),
  );
}

async function setPassword(auth: AuthService, args: Map<string, string>) {
  const email = args.get('email');
  const username = args.get('username');

  if (!email === !username) {
    throw new Error('Give exactly one of --email or --username.');
  }

  const password = await readNewPassword();
  const identifier = email
    ? { email: email.toLowerCase() }
    : { username: username!.toLowerCase() };

  const { userId } = await auth.setPasswordByIdentifier(identifier, password);

  process.stdout.write(
    [
      '',
      `Password set for ${userId}.`,
      'Every session they had is now revoked, so anybody signed in as them has',
      'been signed out.',
      '',
    ].join('\n'),
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || !['create-org', 'set-password'].includes(command)) {
    process.stderr.write(
      'Usage: node dist/cli/admin <create-org|set-password> [options]\n',
    );
    process.exitCode = 1;
    return;
  }

  // `logger: false` keeps Nest's route-mapping banner out of the way; a CLI
  // that prints forty lines before asking for a password is one people stop
  // reading.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const auth = app.get(AuthService);
    if (command === 'create-org') await createOrg(auth, args);
    else await setPassword(auth, args);
  } finally {
    closeSession();
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('admin').error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
