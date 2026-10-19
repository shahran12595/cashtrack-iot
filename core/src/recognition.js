// The core rule: a note is counted only when the checks agree.
//   1. the IR beams give a clear direction,
//   2. the AI Vision Camera is at least 80% sure of the currency and note,
//   3. for notes going IN, the UV check passes.
// Otherwise the app asks the owner to confirm (or flags a suspicious note). It never guesses silently.

import { isValidNote, noteKey } from './currency.js';

export const MIN_CONFIDENCE = 0.8;
export const NON_NOTE_CLASSES = Object.freeze(['no_note', 'other_object']);

/**
 * Parses a model label such as "CNY:100", "BDT:500", "no_note" or "other_object".
 * @returns {{cur:string, value:number} | null} null for non-note classes
 */
export function parseLabel(label) {
  if (NON_NOTE_CLASSES.includes(label)) return null;
  const m = /^([A-Z]{3}):(\d+)$/.exec(label);
  if (!m || !isValidNote(m[1], Number(m[2]))) throw new RangeError(`Unknown model label ${label}`);
  return { cur: m[1], value: Number(m[2]) };
}

/**
 * Decide what to do with one note pass.
 * @param {object} p
 * @param {'IN'|'OUT'|'UNKNOWN'} p.direction from the IR beams
 * @param {{label:string, confidence:number}} p.prediction from the AI Vision Camera
 * @param {boolean} [p.uvPass] UV check result (only used for IN)
 * @param {Record<string, number>} [p.inventory] current wallet notes, used to sanity-check OUT
 * @returns {{action:'COUNT'|'CONFIRM'|'SUSPECT'|'IGNORE', event:string, key?:string, reason?:string}}
 */
export function decide({ direction, prediction, uvPass = true, inventory = null }) {
  const note = parseLabel(prediction.label);
  if (!note) return { action: 'IGNORE', event: 'NONE', reason: 'not a note' };
  const key = noteKey(note.cur, note.value);

  if (direction === 'UNKNOWN') return { action: 'CONFIRM', event: 'DIR?', key, reason: 'direction unclear' };
  if (direction !== 'IN' && direction !== 'OUT') throw new RangeError(`Bad direction ${direction}`);

  if (direction === 'IN' && uvPass === false) {
    return { action: 'SUSPECT', event: 'SUSPECT', key, reason: 'UV check failed' };
  }
  if (!(prediction.confidence >= MIN_CONFIDENCE)) {
    return { action: 'CONFIRM', event: `${direction}?`, key, reason: 'low confidence' };
  }
  if (direction === 'OUT' && inventory && !(inventory[key] > 0)) {
    return { action: 'CONFIRM', event: 'OUT?', key, reason: 'note not in wallet' };
  }
  return { action: 'COUNT', event: direction, key };
}
