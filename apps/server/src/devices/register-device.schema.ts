import { uuidSchema } from '@tccc/shared';
import { z } from 'zod';

export const registerDeviceSchema = z
  .object({
    deviceId: uuidSchema,
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type RegisterDevice = z.infer<typeof registerDeviceSchema>;

export class RegisterDeviceDto {
  static schema = registerDeviceSchema;
}
