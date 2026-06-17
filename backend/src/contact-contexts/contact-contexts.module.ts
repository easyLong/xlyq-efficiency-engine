import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { ContactContextsController } from './contact-contexts.controller';
import { ContactContextsService } from './contact-contexts.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerEntity])],
  controllers: [ContactContextsController],
  providers: [ContactContextsService],
  exports: [ContactContextsService],
})
export class ContactContextsModule {}
