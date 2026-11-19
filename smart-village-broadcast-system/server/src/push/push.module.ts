import { Global, Module } from '@nestjs/common';
import { LogPushProvider } from './log-push.provider.js';
import { PushProvider } from './push.types.js';

@Global()
@Module({
  providers: [{ provide: PushProvider, useClass: LogPushProvider }],
  exports: [PushProvider],
})
export class PushModule {}
