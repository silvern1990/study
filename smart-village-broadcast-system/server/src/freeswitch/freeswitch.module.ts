import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { DirectoryController } from './directory.controller.js';
import { FreeswitchService } from './freeswitch.service.js';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [DirectoryController],
  providers: [FreeswitchService],
  exports: [FreeswitchService],
})
export class FreeswitchModule {}
