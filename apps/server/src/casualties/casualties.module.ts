import { Module } from '@nestjs/common';
import { CasualtiesController } from './casualties.controller.js';
import { CasualtiesService } from './casualties.service.js';

@Module({
  controllers: [CasualtiesController],
  providers: [CasualtiesService],
})
export class CasualtiesModule {}
