// Note direction from two IR break beams across the pocket mouth.
// Beam 1 is on the outside edge, beam 2 is deeper inside the pocket.
//
// A "pass" starts when either beam is blocked and ends when both are clear.
// IN  = the first beam blocked was 1 and the last beam cleared was 2 (the note went all the way in).
// OUT = the first beam blocked was 2 and the last beam cleared was 1.
// Anything else (a note pushed halfway and pulled back, one beam only, a pass longer
// than the timeout) is UNKNOWN, and the app asks the user instead of guessing.

export const BLOCK_THRESHOLD = 0.6; // blocked when the received IR level drops below 60% of the clear baseline
export const PASS_TIMEOUT_MS = 3000;

/** True when the measured beam level means something is in the way. */
export function isBlocked(level, baseline, threshold = BLOCK_THRESHOLD) {
  if (!(baseline > 0)) throw new RangeError('Baseline must be positive');
  return level < baseline * threshold;
}

export class DirectionDetector {
  constructor({ timeoutMs = PASS_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.reset();
  }

  reset() {
    this.blocked = { 1: false, 2: false };
    this.firstBlocked = null;
    this.lastCleared = null;
    this.startedAt = null;
  }

  /**
   * Feed one beam change. Returns null while a pass is in progress,
   * or 'IN' | 'OUT' | 'UNKNOWN' when a pass has finished.
   * @param {{beam: 1|2, blocked: boolean, t: number}} e
   */
  feed({ beam, blocked, t }) {
    if (beam !== 1 && beam !== 2) throw new RangeError('beam must be 1 or 2');
    if (this.blocked[beam] === blocked) return null; // no change (sensor noise)

    if (blocked) {
      if (this.firstBlocked === null) {
        this.firstBlocked = beam;
        this.startedAt = t;
      }
      this.blocked[beam] = true;
      return null;
    }

    this.blocked[beam] = false;
    this.lastCleared = beam;
    if (this.blocked[1] || this.blocked[2]) return null;

    const tooSlow = t - this.startedAt > this.timeoutMs;
    const result = tooSlow
      ? 'UNKNOWN'
      : this.firstBlocked === 1 && this.lastCleared === 2
        ? 'IN'
        : this.firstBlocked === 2 && this.lastCleared === 1
          ? 'OUT'
          : 'UNKNOWN';
    this.reset();
    return result;
  }
}

/** Convenience: run a whole list of beam events and return every completed pass. */
export function detectAll(events, opts) {
  const d = new DirectionDetector(opts);
  const out = [];
  for (const e of events) {
    const r = d.feed(e);
    if (r) out.push(r);
  }
  return out;
}
