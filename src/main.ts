import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  const isProd = process.env.NODE_ENV === 'production';

  // ─── Behind Nginx reverse proxy: trust X-Forwarded-* for real client IP ────
  // This makes rate-limiting count the real user IP, not the Nginx container IP.
  app.set('trust proxy', 1);

  // ─── Security headers (helmet) ─────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: isProd ? undefined : false, // CSP off in dev (Swagger needs inline scripts)
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ─── gzip ──────────────────────────────────────────────────────────────────
  app.use(compression());

  // ─── CORS: explicit whitelist in prod, open in dev ────────────────────────
  const allowed = (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: isProd
      ? (origin, cb) => {
          // Same-origin requests (no Origin header) → allow (mobile apps, curl)
          if (!origin) return cb(null, true);
          if (allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
          return cb(new Error(`CORS blocked: ${origin}`), false);
        }
      : '*',
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,Accept,Origin,X-Requested-With',
  });

  // ─── Global validation ────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ─── Body size limit (prevent JSON bombs) ─────────────────────────────────
  app.use(require('express').json({ limit: '1mb' }));
  app.use(require('express').urlencoded({ extended: true, limit: '1mb' }));

  // ─── Swagger: only in non-prod, or behind extra auth in prod ──────────────
  if (!isProd || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Quinielas Mundial 2026 API')
      .setDescription('API for sports betting pools application')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document, {
      customCss: `.swagger-ui .topbar { display: none } .swagger-ui .info .title { color: #0052CC; }`,
      customSiteTitle: 'Quinielas Mundial 2026 API',
    });
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 API on :${port}  (env=${process.env.NODE_ENV ?? 'development'})`);
}

bootstrap();
