import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './common/configure-app.js';

// `Access-Control-Allow-Origin: *` is rejected by browsers when credentials are
// enabled, so each allowed site is listed and the matching Origin is echoed.
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function corsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
