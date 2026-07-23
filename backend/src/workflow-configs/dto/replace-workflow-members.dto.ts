import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class ReplaceWorkflowMembersDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  userIds!: string[];
}
