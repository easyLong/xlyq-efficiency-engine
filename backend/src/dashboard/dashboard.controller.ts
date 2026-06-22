import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { UserEntity } from '../users/entities/user.entity';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  overview(@Req() request?: Request & { user?: UserEntity }) {
    return this.dashboardService.overview(request?.user ?? null);
  }
}
