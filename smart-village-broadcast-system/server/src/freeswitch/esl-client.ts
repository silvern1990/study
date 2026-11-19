import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';

/**
 * FreeSWITCH Event Socket(inbound) 최소 구현.
 * - auth, api, event 구독만 지원
 * - 응답(command/reply, api/response)은 보낸 순서대로 돌아오므로 FIFO 큐로 매칭
 *
 * 이벤트: 'event' (EslEvent), 'close'
 */
export type EslHeaders = Record<string, string>;

export interface EslEvent {
  headers: EslHeaders;
  body: string;
}

interface Pending {
  resolve: (value: { headers: EslHeaders; body: string }) => void;
  reject: (err: Error) => void;
}

export interface EslClientOptions {
  host: string;
  port: number;
  password: string;
}

export class EslClient extends EventEmitter {
  private socket?: Socket;
  private buffer = Buffer.alloc(0);
  private pending: Pending[] = [];
  private authWaiter?: () => void;

  constructor(private readonly options: EslClientOptions) {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.options.host,
        port: this.options.port,
      });
      this.socket = socket;
      this.buffer = Buffer.alloc(0);

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => socket.off('error', onError);
      socket.once('error', onError);

      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('close', () => this.onClose());

      this.authWaiter = () => {
        this.authWaiter = undefined;
        this.command(`auth ${this.options.password}`)
          .then((reply) => {
            cleanup();
            socket.on('error', (err) => this.emit('socketError', err));
            if (!reply.headers['Reply-Text']?.startsWith('+OK')) {
              socket.destroy();
              reject(new Error(`ESL auth failed: ${reply.headers['Reply-Text']}`));
              return;
            }
            resolve();
          })
          .catch(onError);
      };
    });
  }

  /** 'api <cmd>' 결과 본문 */
  async api(cmd: string): Promise<string> {
    const res = await this.command(`api ${cmd}`);
    return res.body.trim();
  }

  async subscribe(events: string[]): Promise<void> {
    const reply = await this.command(`event plain ${events.join(' ')}`);
    if (!reply.headers['Reply-Text']?.startsWith('+OK')) {
      throw new Error(`ESL subscribe failed: ${reply.headers['Reply-Text']}`);
    }
  }

  close() {
    this.socket?.destroy();
  }

  private command(line: string) {
    return new Promise<{ headers: EslHeaders; body: string }>(
      (resolve, reject) => {
        if (!this.socket || this.socket.destroyed) {
          reject(new Error('ESL not connected'));
          return;
        }
        this.pending.push({ resolve, reject });
        this.socket.write(`${line}\n\n`);
      },
    );
  }

  private onClose() {
    const err = new Error('ESL connection closed');
    for (const p of this.pending.splice(0)) p.reject(err);
    this.emit('close');
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\n\n');
      if (headerEnd < 0) return;
      const headers = parseHeaders(
        this.buffer.subarray(0, headerEnd).toString('utf8'),
        false,
      );
      const length = Number.parseInt(headers['Content-Length'] ?? '0', 10);
      const total = headerEnd + 2 + length;
      if (this.buffer.length < total) return;
      const body = this.buffer.subarray(headerEnd + 2, total).toString('utf8');
      this.buffer = this.buffer.subarray(total);
      this.dispatch(headers, body);
    }
  }

  private dispatch(headers: EslHeaders, body: string) {
    switch (headers['Content-Type']) {
      case 'auth/request':
        this.authWaiter?.();
        break;
      case 'command/reply':
      case 'api/response':
        this.pending.shift()?.resolve({ headers, body });
        break;
      case 'text/event-plain':
        this.emit('event', parsePlainEvent(body));
        break;
      case 'text/disconnect-notice':
        this.socket?.end();
        break;
      default:
        break;
    }
  }
}

function parseHeaders(text: string, urlDecode: boolean): EslHeaders {
  const headers: EslHeaders = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (urlDecode) {
      try {
        value = decodeURIComponent(value);
      } catch {
        // 디코딩 실패 시 원문 유지
      }
    }
    headers[key] = value;
  }
  return headers;
}

/** text/event-plain 본문: url-encoded 헤더 + (선택) Content-Length 만큼의 본문 */
export function parsePlainEvent(raw: string): EslEvent {
  const sep = raw.indexOf('\n\n');
  const headerText = sep >= 0 ? raw.slice(0, sep) : raw;
  const headers = parseHeaders(headerText, true);
  const body = sep >= 0 ? raw.slice(sep + 2) : '';
  return { headers, body };
}
