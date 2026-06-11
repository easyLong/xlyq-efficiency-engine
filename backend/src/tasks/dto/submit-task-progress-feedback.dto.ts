import { IsIn } from 'class-validator';

export class SubmitTaskProgressFeedbackDto {
  @IsIn(['in_progress', 'completed'])
  status!: 'in_progress' | 'completed';
}
