import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { env } from './config/env';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  environment: string;
  database: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthStatus> {
    const databaseUp = await this.prisma.isReachable();

    return {
      status: databaseUp ? 'ok' : 'degraded',
      environment: env.NODE_ENV,
      database: databaseUp ? 'up' : 'down',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
