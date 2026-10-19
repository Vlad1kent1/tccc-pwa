import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const logger = new Logger('PrismaService');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    super({
      adapter: new PrismaPg(
        {
          connectionString,
          // A request that finds every pooled connection busy fails instead of waiting forever.
          connectionTimeoutMillis: 10_000,
          // A card lock held this long ends the wait with an error the sync service retries.
          lock_timeout: 5_000,
          // Postgres closes a session left idle inside a transaction, which releases its card locks.
          idle_in_transaction_session_timeout: 60_000,
        },
        {
          onPoolError: (error) => logger.warn(`Idle database connection failed: ${error.message}`),
          onConnectionError: (error) => logger.warn(`Database connection error: ${error.message}`),
        },
      ),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
