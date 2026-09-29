#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

/**
 * Regenerates `src/api/schema.d.ts` from the running API's OpenAPI document.
 *
 * A script rather than a one-line npm command because npm runs scripts through
 * `cmd.exe` on Windows, where `${API_DOCS_URL:-http://…}` is not shell syntax —
 * it is passed through as a literal filename and openapi-typescript then fails
 * looking for a file called `${API_DOCS_URL:-http:\localhost:4000\docs-json}`.
 * Reading the environment here works the same way on every platform.
 *
 * The server must be running, and `SWAGGER_ENABLED=true` — it defaults to off,
 * so a production instance publishes no map of itself.
 */
const url = process.env.API_DOCS_URL ?? 'http://localhost:4000/docs-json';
const out = 'src/api/schema.d.ts';

const result = spawnSync(
  'npx',
  ['openapi-typescript', url, '-o', out],
  { stdio: 'inherit', shell: true },
);

if (result.status !== 0) {
  console.error(
    `\nCould not read the OpenAPI document at ${url}.\n` +
      `Is the API running, and is SWAGGER_ENABLED=true in its .env?\n` +
      `Point somewhere else with API_DOCS_URL.`,
  );
  process.exit(result.status ?? 1);
}
