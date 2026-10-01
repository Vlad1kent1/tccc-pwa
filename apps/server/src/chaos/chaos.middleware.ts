import type { NextFunction, Request, Response } from 'express';
import { chaosState } from './chaos.state.js';

function isExempt(url: string): boolean {
  return url.startsWith('/api/health') || url.startsWith('/api/chaos');
}

/**
 * Fault injection for sync tests (PLAN.md 6.2). Inactive unless CHAOS_ENABLED=true.
 * A drop replaces the response write so the handler, including its DB transaction,
 * has already finished when the socket closes.
 */
export function chaosMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!chaosState.enabled || isExempt(req.originalUrl.split('?')[0] ?? '')) {
    next();
    return;
  }

  const latency = chaosState.latencyMs > 0 ? Math.floor(Math.random() * (chaosState.latencyMs + 1)) : 0;
  setTimeout(() => {
    if (res.headersSent) return;
    // Only mutations are faulted. GET pull and health stay available so a client
    // can retry and a test can observe the committed rows.
    if (req.method !== 'GET' && Math.random() < chaosState.failureRate) {
      res.status(503).json({ statusCode: 503, message: 'Chaos failure' });
      return;
    }
    if (req.method !== 'GET' && Math.random() < chaosState.dropRate) {
      armDrop(req, res);
    }
    next();
  }, latency);
}

function armDrop(req: Request, res: Response): void {
  // Swallow the body so the client never sees a complete response, but destroy
  // the socket on a later turn. Doing it inside `res.end` emits `close` before
  // the handler's transaction has finished committing.
  res.write = (() => true) as typeof res.write;
  res.end = (() => {
    setTimeout(() => req.socket?.destroy(), 30);
    return res;
  }) as typeof res.end;
}
