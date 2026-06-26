import { canonicalJson, sha256 } from './hash.js';
import type { EventEnvelope, VirtualTimestamp } from './types.js';

const GENESIS_HASH = sha256('terrarium-genesis');

export class EventLog {
  private events: EventEnvelope[] = [];
  private seq = 0;

  append(type: string, at: VirtualTimestamp, payload: Record<string, unknown>): EventEnvelope {
    const prev_hash = this.events.at(-1)?.hash ?? GENESIS_HASH;
    const body = {
      seq: this.seq,
      type,
      at,
      payload,
      prev_hash,
    };
    const hash = sha256(canonicalJson(body));
    const envelope: EventEnvelope = { ...body, hash };
    this.events.push(envelope);
    this.seq += 1;
    return envelope;
  }

  all(): readonly EventEnvelope[] {
    return this.events;
  }

  export(): EventEnvelope[] {
    return [...this.events];
  }

  load(events: EventEnvelope[]): void {
    this.events = [...events];
    this.seq = events.length;
  }

  verifyChain(): boolean {
    let prev = GENESIS_HASH;
    for (const event of this.events) {
      if (event.prev_hash !== prev) return false;
      const body = {
        seq: event.seq,
        type: event.type,
        at: event.at,
        payload: event.payload,
        prev_hash: event.prev_hash,
      };
      if (sha256(canonicalJson(body)) !== event.hash) return false;
      prev = event.hash;
    }
    return true;
  }
}