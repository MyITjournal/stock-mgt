import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';

/**
 * The built dashboard, when there is one beside us.
 *
 * `__dirname` is `dist/` at runtime, so this is `<repo>/web/dist` — present on
 * a deployment whose build step ran `web`'s build, absent on a developer
 * machine running `start:dev` against Vite on 5173. Absent is the normal case
 * locally and must stay silent.
 */
const WEB_ROOT = join(__dirname, '..', 'web', 'dist');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix(env.API_PREFIX);

  /**
   * Response security headers.
   *
   * Mostly belt-and-braces for a JSON API, but two of them earn their place on
   * Render: HSTS, so a client that reaches the API over http is told never to
   * do it again, and `nosniff`, so a stored filename or note can never be
   * sniffed into something executable by a browser that fetched it directly.
   *
   * `contentSecurityPolicy` is off because Swagger's UI needs inline scripts
   * and styles; a policy tight enough to be worth having would break it, and
   * Swagger is off in production anyway. **This is now worth revisiting**: the
   * dashboard is served from here too (see `serveDashboard`), and Vite emits
   * external scripts only, so a real policy is feasible for it — it just needs
   * to exempt `/docs` rather than the whole server.
   *
   * `crossOriginResourcePolicy` is relaxed for the same reason the CORS block
   * below exists: the mobile app and any other client reach this from their own
   * origin, even though the dashboard no longer does.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // A spreadsheet of a whole catalog is bigger than the 100kb JSON body every
  // other route is held to — 2,000 rows of twelve cells is about a megabyte.
  // Raised for that one route only, and registered before Nest's own parser,
  // which then finds the body already read and leaves it alone.
  //
  // ⚠ The wrapper's *name* is load-bearing. Nest decides whether to add its
  // own JSON parser by looking for a middleware called `jsonParser` — the name
  // body-parser gives its function — anywhere in the stack, path or no path.
  // Registered bare, this one route's parser made Nest skip the global one,
  // and every other request in the API arrived with an empty body.
  const catalogImportParser = json({ limit: '3mb' });
  app.use(
    `/${env.API_PREFIX.replace(/^\/+/, '')}/products/import`,
    function catalogImportBody(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      catalogImportParser(req, res, next);
    },
  );

  // Auth tokens are also delivered as httpOnly cookies for the web dashboard.
  app.use(cookieParser());

  // Rate limiting and lastLoginIp need the real client IP behind a proxy.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  app.enableShutdownHooks();

  serveDashboard(app);

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('Reho API')
      .setDescription('Sales and inventory for FMCG businesses')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT',
      )
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, config),
      {
        swaggerOptions: {
          persistAuthorization: true,
          // Send the httpOnly auth cookies with try-it-out requests. Without
          // this, Swagger's only credential is the string pasted into the
          // Authorize box, which nothing renews — so the session dies with the
          // access token and has to be pasted again. With it, POST
          // /auth/refresh renews in place: the browser swaps the cookie itself.
          withCredentials: true,
        },
      },
    );
  }

  await app.listen(env.PORT);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${env.PORT}/${env.API_PREFIX}`);
  if (env.SWAGGER_ENABLED) {
    logger.log(`Swagger UI on http://localhost:${env.PORT}/docs`);
  }
  logger.log(
    existsSync(join(WEB_ROOT, 'index.html'))
      ? `Dashboard served from this origin at http://localhost:${env.PORT}/`
      : 'No built dashboard beside this server — run Vite separately, or build web/',
  );
}

/**
 * Serves the dashboard from this server, on this origin.
 *
 * ## Why the dashboard is not its own host
 *
 * Auth is httpOnly cookies set `sameSite: 'lax'`, and the browser sends a Lax
 * cookie on same-site requests only. On Render's default hosting the two halves
 * would be `dashboard-x.onrender.com` and `api-x.onrender.com` — and because
 * `onrender.com` is on the Public Suffix List, those are different *sites*, not
 * merely different origins. Every authenticated request would arrive with no
 * cookie.
 *
 * The failure is worse than it sounds: signing in would appear to work, because
 * `POST /auth/login` returns the tokens in the body as well, and then every
 * request after it would answer 401. `COOKIE_DOMAIN=.onrender.com` cannot
 * rescue it either, since browsers reject a cookie scoped to a public suffix.
 *
 * One origin removes the problem rather than working around it: no CORS in the
 * browser's path, no third-party cookie, and nothing to re-decide when Chrome
 * finishes phasing those out. It also survives moving to a custom domain later,
 * which `sameSite: 'none'` would not have done for Safari.
 *
 * ## Ordering
 *
 * Both of these are plain Express middleware, so they run **before** Nest's
 * router. The fallback therefore has to step aside for anything the API owns —
 * it cannot rely on being reached last. It answers only GET and HEAD, and only
 * for paths that are not the API, not Swagger, and carry no file extension: a
 * missing `/assets/index-abc.js` must 404 as itself rather than quietly
 * resolving to the HTML shell, which turns a failed deploy into a blank page
 * with no error.
 */
function serveDashboard(app: NestExpressApplication): void {
  if (!existsSync(join(WEB_ROOT, 'index.html'))) return;

  const apiPrefix = `/${env.API_PREFIX.replace(/^\/+/, '')}`;
  const index = join(WEB_ROOT, 'index.html');

  // Vite fingerprints every asset filename, so they are safe to cache hard.
  // `index.html` is not fingerprinted and must never be, or a deploy ships new
  // assets that nothing asks for.
  app.useStaticAssets(WEB_ROOT, { index: false, maxAge: '1y', etag: true });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith(apiPrefix) || req.path.startsWith('/docs')) {
      return next();
    }
    if (req.path.includes('.')) return next();

    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

void bootstrap();
