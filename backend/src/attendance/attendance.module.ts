import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuModule } from '../integrations/feishu/feishu.module';
import { UserEntity } from '../users/entities/user.entity';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), FeishuModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
