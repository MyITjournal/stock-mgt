import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix(env.API_PREFIX);

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

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('Stock Mgt API')
      .setDescription('Sales and inventory management for FMCG businesses')
      .setVersion('0.1')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT',
      )
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, config),
      { swaggerOptions: { persistAuthorization: true } },
    );
  }

  await app.listen(env.PORT);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${env.PORT}/${env.API_PREFIX}`);
  if (env.SWAGGER_ENABLED) {
    logger.log(`Swagger UI on http://localhost:${env.PORT}/docs`);
  }
}

void bootstrap();
