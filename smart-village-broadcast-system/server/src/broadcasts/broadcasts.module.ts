import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingsModule } from '../recordings/recordings.module.js';
import { User } from '../users/user.entity.js';
import { UsersModule } from '../users/users.module.js';
import { BroadcastDispatcher } from './broadcast-dispatcher.js';
import { BROADCAST_QUEUE } from './broadcast-queue.js';
import { Broadcast, BroadcastTarget } from './broadcast.entity.js';
import { BroadcastProcessor } from './broadcast.processor.js';
import { BroadcastsController } from './broadcasts.controller.js';
import { BroadcastsService } from './broadcasts.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Broadcast, BroadcastTarget, User]),
    BullModule.registerQueue({
      name: BROADCAST_QUEUE,
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    }),
    RecordingsModule,
    UsersModule,
  ],
  controllers: [BroadcastsController],
  providers: [BroadcastsService, BroadcastDispatcher, BroadcastProcessor],
})
export class BroadcastsModule {}
