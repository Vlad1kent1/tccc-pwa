import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CasualtiesModule } from './casualties/casualties.module.js';
import { ChaosModule } from './chaos/chaos.module.js';
import { UnitTokenGuard } from './common/unit-token.guard.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [PrismaModule, HealthModule, DevicesModule, CasualtiesModule, SyncModule, ChaosModule],
  // Deny by default: a controller added later is protected without remembering a decorator.
  providers: [{ provide: APP_GUARD, useClass: UnitTokenGuard }],
})
export class AppModule {}
