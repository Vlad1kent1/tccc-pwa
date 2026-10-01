import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RegisterDevice } from './register-device.schema.js';

export interface RegisteredDevice {
  deviceId: string;
  label: string | null;
  lastSeenAt: string;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Upserts the device and refreshes `lastSeenAt`. A missing label leaves the stored one in place. */
  async register(input: RegisterDevice): Promise<RegisteredDevice> {
    const now = new Date();
    const device = await this.prisma.device.upsert({
      where: { id: input.deviceId },
      create: {
        id: input.deviceId,
        label: input.label ?? null,
        lastSeenAt: now,
      },
      update: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        lastSeenAt: now,
      },
    });
    return {
      deviceId: device.id,
      label: device.label,
      lastSeenAt: device.lastSeenAt.toISOString(),
    };
  }
}
