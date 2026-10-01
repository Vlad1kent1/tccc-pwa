import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { SyncService } from './sync.service.js';
import {
  ListConflictsQueryDto,
  PullQueryDto,
  PushRequestDto,
  ResolveConflictDto,
  type ListConflictsQuery,
  type ResolveConflict,
} from './sync.schemas.js';
import type { PullQuery, PushRequest } from '@tccc/shared';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  push(@Body() body: PushRequestDto) {
    const request = body as unknown as PushRequest;
    return this.sync.push(request.deviceId, request.mutations);
  }

  @Get('pull')
  pull(@Query() query: PullQueryDto) {
    const parsed = query as unknown as PullQuery;
    return this.sync.pull(parsed.since, parsed.limit);
  }

  @Get('conflicts')
  listConflicts(@Query() query: ListConflictsQueryDto) {
    return this.sync.listConflicts(query as unknown as ListConflictsQuery);
  }

  @Post('conflicts/:id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveConflictDto) {
    return this.sync.resolve(id, body as unknown as ResolveConflict);
  }
}
