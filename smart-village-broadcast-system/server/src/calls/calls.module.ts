import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { CallsListener } from './calls.listener.js';

@Module({
  imports: [UsersModule],
  providers: [CallsListener],
})
export class CallsModule {}
