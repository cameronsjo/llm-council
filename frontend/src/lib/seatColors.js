/**
 * Seat-color assignment — the signature of the "Deliberation Instrument" theme.
 *
 * Each council model carries a persistent "seat" color (one of 5 curated
 * swatches) that follows it everywhere: avatar, opinion tab, peer-review row,
 * standings bar. Assignment is a pure function of the council *set*:
 *
 *   - Deterministic + stable across sessions: the seat derives from a hash of
 *     the model id, never from random state or insertion order.
 *   - Stable across council reordering: ids are resolved in a canonical order
 *     (by hash, then id), so reordering the roster never reshuffles colors.
 *   - Collision-nudged: a council of <=5 models stays visually distinct — when
 *     two ids hash to the same seat, later ones probe forward to a free seat.
 *   - Beyond 5 models every seat is in use, so repeats are allowed at the raw
 *     hashed seat.
 */

export const SEAT_COUNT = 5;

/**
 * Deterministic 32-bit FNV-1a hash of a string -> unsigned int32.
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Token bundle for a 1-based seat number.
 * @param {number} seat - 1..SEAT_COUNT
 * @returns {{ seat: number, color: string, soft: string }}
 */
export function seatTokens(seat) {
  return {
    seat,
    color: `var(--seat-${seat})`,
    soft: `var(--seat-${seat}-soft)`,
  };
}

/**
 * Raw hashed seat (1..SEAT_COUNT) for an id, ignoring collisions.
 * @param {string} id
 * @returns {number}
 */
export function rawSeat(id) {
  return (hashString(id) % SEAT_COUNT) + 1;
}

/**
 * Assign a stable seat to each council model.
 * @param {string[]} councilIds
 * @returns {Map<string, { seat: number, color: string, soft: string }>}
 */
export function assignSeats(councilIds = []) {
  const ids = (Array.isArray(councilIds) ? councilIds : []).filter((id) => id != null).map(String);

  // Dedupe (assignment is set-based); first occurrence wins.
  const unique = [...new Set(ids)];

  // Canonical order: by hash, then id. Order-independent so reordering the
  // roster never changes any model's color.
  const ordered = [...unique].sort((a, b) => {
    const ha = hashString(a);
    const hb = hashString(b);
    if (ha !== hb) return ha - hb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const map = new Map();
  const taken = new Set(); // seat indices 0..SEAT_COUNT-1 currently in use

  for (const id of ordered) {
    const start = hashString(id) % SEAT_COUNT;
    let idx = start;
    if (taken.size < SEAT_COUNT) {
      // Linear probe forward to keep a council of <=5 visually distinct.
      while (taken.has(idx)) idx = (idx + 1) % SEAT_COUNT;
      taken.add(idx);
    }
    // else: every seat is in use -> keep the raw hashed seat (repeats allowed).
    map.set(id, seatTokens(idx + 1));
  }

  return map;
}
