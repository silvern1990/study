import { parsePlainEvent } from './esl-client.js';

describe('parsePlainEvent', () => {
  it('url-decodes header values', () => {
    const evt = parsePlainEvent(
      'Event-Name: CUSTOM\nEvent-Subclass: svbs%3A%3Awake\ncaller: 20002\n\n',
    );
    expect(evt.headers['Event-Name']).toBe('CUSTOM');
    expect(evt.headers['Event-Subclass']).toBe('svbs::wake');
    expect(evt.headers['caller']).toBe('20002');
  });

  it('keeps raw value when decoding fails', () => {
    const evt = parsePlainEvent('X: 100%\n\n');
    expect(evt.headers['X']).toBe('100%');
  });
});
