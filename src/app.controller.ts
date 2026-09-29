import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, HealthStatus } from './app.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Load balancers and uptime checks cannot present a token.
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity check' })
  getHealth(): Promise<HealthStatus> {
    return this.appService.getHealth();
  }
}
