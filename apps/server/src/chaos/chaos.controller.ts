import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { chaosState, updateChaos } from './chaos.state.js';

@Controller('chaos')
export class ChaosController {
  @Get()
  current() {
    this.assertEnabled();
    return chaosState;
  }

  @Post()
  update(@Body() body: { latencyMs?: number; failureRate?: number; dropRate?: number }) {
    this.assertEnabled();
    return updateChaos({
      latencyMs: typeof body?.latencyMs === 'number' ? body.latencyMs : undefined,
      failureRate: typeof body?.failureRate === 'number' ? body.failureRate : undefined,
      dropRate: typeof body?.dropRate === 'number' ? body.dropRate : undefined,
    });
  }

  private assertEnabled(): void {
    if (!chaosState.enabled) {
      throw new NotFoundException();
    }
  }
}
