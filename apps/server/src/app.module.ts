import { Module } from '@nestjs/common';
import { CasualtiesModule } from './casualties/casualties.module.js';
import { ChaosModule } from './chaos/chaos.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [PrismaModule, HealthModule, DevicesModule, CasualtiesModule, SyncModule, ChaosModule],
})
export class AppModule {}
