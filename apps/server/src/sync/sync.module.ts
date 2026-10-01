import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
