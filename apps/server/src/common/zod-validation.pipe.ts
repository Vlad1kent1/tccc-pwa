import { BadRequestException, Injectable, type PipeTransform, type ArgumentMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export interface ZodSchemaHost {
  schema: ZodType;
}

export function hasZodSchema(metatype: unknown): metatype is ZodSchemaHost {
  return (
    typeof metatype === 'function' &&
    'schema' in metatype &&
    typeof (metatype as { schema?: unknown }).schema === 'object' &&
    (metatype as { schema?: { safeParse?: unknown } }).schema?.safeParse !== undefined
  );
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!hasZodSchema(metadata.metatype)) {
      return value;
    }
    const parsed = metadata.metatype.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.issues,
      });
    }
    return parsed.data;
  }
}
