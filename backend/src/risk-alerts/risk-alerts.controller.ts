import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DetectRiskAlertsDto } from './dto/detect-risk-alerts.dto';
import { RiskAlertsService } from './risk-alerts.service';

@Controller('risk-alerts')
export class RiskAlertsController {
  constructor(private readonly riskAlertsService: RiskAlertsService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('alertType') alertType?: string,
  ) {
    return this.riskAlertsService.findAll(projectId, status, severity, alertType);
  }

  @Post('detect')
  detect(@Body() dto: DetectRiskAlertsDto) {
    return this.riskAlertsService.detect(dto.projectId);
  }

  @Post(':alertId/acknowledge')
  acknowledge(@Param('alertId') alertId: string) {
    return this.riskAlertsService.acknowledge(alertId);
  }

  @Post(':alertId/resolve')
  resolve(@Param('alertId') alertId: string) {
    return this.riskAlertsService.resolve(alertId);
  }
}
