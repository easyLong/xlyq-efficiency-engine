import { IsUUID } from 'class-validator';

export class DetectRiskAlertsDto {
  @IsUUID()
  projectId!: string;
}
