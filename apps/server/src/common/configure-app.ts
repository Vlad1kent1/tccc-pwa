import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { chaosMiddleware } from '../chaos/chaos.middleware.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** Global prefix, validation, error responses and logging, and Swagger at `/api/docs`. CORS is set in `main.ts`. */
export function configureApp(app: INestApplication): void {
  app.use(chaosMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('TCCC Medical')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'API_UNIT_TOKEN' })
    .addSecurityRequirements('bearer')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
