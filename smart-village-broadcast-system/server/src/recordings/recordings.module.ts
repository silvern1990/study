import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { tmpdir } from 'node:os';
import type { AppConfig } from '../config/configuration.js';
import { UsersModule } from '../users/users.module.js';
import { Recording } from './recording.entity.js';
import { RecordingsController } from './recordings.controller.js';
import { RecordingsService } from './recordings.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recording]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        dest: tmpdir(),
        limits: {
          fileSize: config.get('recordings.maxUploadBytes', { infer: true }),
        },
      }),
    }),
    UsersModule,
  ],
  controllers: [RecordingsController],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
