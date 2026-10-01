import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { chaosMiddleware } from '../chaos/chaos.middleware.js';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** Global prefix, validation, Prisma errors, and Swagger at `/api/docs`. CORS is set in `main.ts`. */
export function configureApp(app: INestApplication): void {
  app.use(chaosMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = new DocumentBuilder().setTitle('TCCC Medical').setVersion('1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
