import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BroadcastsModule } from './broadcasts/broadcasts.module.js';
import { CallsModule } from './calls/calls.module.js';
import { configuration, type AppConfig } from './config/configuration.js';
import { FreeswitchModule } from './freeswitch/freeswitch.module.js';
import { PushModule } from './push/push.module.js';
import { RecordingsModule } from './recordings/recordings.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const db = config.get('database', { infer: true });
        return {
          type: 'postgres',
          url: db.url,
          autoLoadEntities: true,
          synchronize: db.synchronize,
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: config.get('redis', { infer: true }),
      }),
    }),
    PushModule,
    FreeswitchModule,
    UsersModule,
    RecordingsModule,
    BroadcastsModule,
    CallsModule,
  ],
})
export class AppModule {}
