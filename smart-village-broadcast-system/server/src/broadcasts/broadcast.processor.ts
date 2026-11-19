import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { BroadcastDispatcher } from './broadcast-dispatcher.js';
import {
  BROADCAST_QUEUE,
  BroadcastJob,
  type RingJobData,
  type StartJobData,
} from './broadcast-queue.js';

@Processor(BROADCAST_QUEUE, { concurrency: 20 })
export class BroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(BroadcastProcessor.name);

  constructor(private readonly dispatcher: BroadcastDispatcher) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case BroadcastJob.Start:
        return this.dispatcher.start((job.data as StartJobData).broadcastId);
      case BroadcastJob.Ring:
        return this.dispatcher.ring(job.data as RingJobData);
      case BroadcastJob.RingTimeout:
        return this.dispatcher.ringTimeout(job.data as RingJobData);
      default:
        this.logger.warn(`unknown job ${job.name}`);
    }
  }
}
