import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

const STATUS_BY_CODE: Record<string, number> = {
  P2002: HttpStatus.CONFLICT,
  P2025: HttpStatus.NOT_FOUND,
};

const MESSAGE_BY_CODE: Record<string, string> = {
  P2002: 'Unique constraint failed',
  P2025: 'Record not found',
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const response = host.switchToHttp().getResponse<Response>();
    response.status(status).json({
      statusCode: status,
      message: MESSAGE_BY_CODE[exception.code] ?? 'Database error',
      error: exception.code,
    });
  }
}
