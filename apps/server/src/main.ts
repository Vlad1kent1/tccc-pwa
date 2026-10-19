import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './common/configure-app.js';
import { configuredUnitToken, MIN_UNIT_TOKEN_LENGTH } from './common/unit-token.guard.js';

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

function requireUnitToken(): void {
  const token = configuredUnitToken();
  if (!token || token.length < MIN_UNIT_TOKEN_LENGTH) {
    throw new Error(
      `API_UNIT_TOKEN must be set to at least ${MIN_UNIT_TOKEN_LENGTH} characters. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }
}

async function bootstrap() {
  requireUnitToken();
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
