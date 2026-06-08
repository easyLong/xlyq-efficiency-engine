import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { ContactContextsController } from './contact-contexts.controller';
import { ContactContextsService } from './contact-contexts.service';
import { ContactContextConfigEntity } from './entities/contact-context-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactContextConfigEntity, CustomerEntity])],
  controllers: [ContactContextsController],
  providers: [ContactContextsService],
  exports: [ContactContextsService],
})
export class ContactContextsModule {}
