import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppEvents, type WakeRequestedEvent } from '../common/events.js';
import { PushProvider } from '../push/push.types.js';
import { UsersService } from '../users/users.service.js';

/**
 * 1:1 통화: 수신자가 SIP 에 등록되어 있지 않으면 FreeSWITCH(call.lua)가
 * svbs::wake 이벤트를 보내고 등록될 때까지 기다린다. 여기서 수신자에게 푸시를 보낸다.
 */
@Injectable()
export class CallsListener {
  private readonly logger = new Logger(CallsListener.name);

  constructor(
    private readonly users: UsersService,
    private readonly push: PushProvider,
  ) {}

  @OnEvent(AppEvents.WakeRequested, { async: true, suppressErrors: true })
  async onWake(evt: WakeRequestedEvent) {
    const callee = await this.users.findByExtension(evt.callee);
    if (!callee) {
      this.logger.warn(`wake for unknown extension ${evt.callee}`);
      return;
    }
    await this.push.send(callee, {
      type: 'call',
      caller: evt.caller,
      callUuid: evt.callUuid,
    });
  }
}
