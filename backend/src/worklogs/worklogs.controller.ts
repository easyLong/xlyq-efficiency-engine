import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateWorklogDto } from './dto/create-worklog.dto';
import { UpdateWorklogDto } from './dto/update-worklog.dto';
import { WorklogsService } from './worklogs.service';

@Controller('worklogs')
export class WorklogsController {
  constructor(private readonly worklogsService: WorklogsService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('taskId') taskId?: string,
    @Query('userId') userId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.worklogsService.findAll(projectId, taskId, userId, dateFrom, dateTo);
  }

  @Get(':worklogId')
  findOne(@Param('worklogId') worklogId: string) {
    return this.worklogsService.findOne(worklogId);
  }

  @Post()
  create(@Body() dto: CreateWorklogDto) {
    return this.worklogsService.create(dto);
  }

  @Patch(':worklogId')
  update(@Param('worklogId') worklogId: string, @Body() dto: UpdateWorklogDto) {
    return this.worklogsService.update(worklogId, dto);
  }

  @Delete(':worklogId')
  remove(@Param('worklogId') worklogId: string) {
    return this.worklogsService.remove(worklogId);
  }

  @Post(':worklogId/submit')
  submit(@Param('worklogId') worklogId: string) {
    return this.worklogsService.submit(worklogId);
  }

  @Post(':worklogId/approve')
  approve(@Param('worklogId') worklogId: string) {
    return this.worklogsService.approve(worklogId);
  }
}
