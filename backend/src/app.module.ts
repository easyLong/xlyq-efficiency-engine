import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactContextsModule } from './contact-contexts/contact-contexts.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DimensionsModule } from './dimensions/dimensions.module';
import { HealthModule } from './health/health.module';
import { FeishuModule } from './integrations/feishu/feishu.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { QuoteMappingsModule } from './quote-mappings/quote-mappings.module';
import { QuotationsModule } from './quotations/quotations.module';
import { RequirementsModule } from './requirements/requirements.module';
import { RiskAlertsModule } from './risk-alerts/risk-alerts.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { WeeklyReportsModule } from './weekly-reports/weekly-reports.module';
import { WorklogsModule } from './worklogs/worklogs.module';
import { WorkflowConfigsModule } from './workflow-configs/workflow-configs.module';
import { MvpAuthGuard } from './common/guards/mvp-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
        logging: false,
      }),
    }),
    HealthModule,
    ContactContextsModule,
    FeishuModule,
    NotificationsModule,
    CustomersModule,
    UsersModule,
    WorkflowConfigsModule,
    ProjectsModule,
    RequirementsModule,
    TasksModule,
    WorklogsModule,
    RiskAlertsModule,
    WeeklyReportsModule,
    QuotationsModule,
    QuoteMappingsModule,
    DashboardModule,
    DimensionsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: MvpAuthGuard,
    },
  ],
})
export class AppModule {}
