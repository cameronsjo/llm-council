import { useMemo } from 'react';
import { assignSeats, seatTokens, rawSeat } from '../lib/seatColors';
import { useConfig } from './queries';

// Stable empty reference so an unloaded config doesn't churn the memo.
const EMPTY_IDS = [];

/**
 * Seat-color assignment for the current council.
 *
 * Returns `seatOf(modelId)` -> `{ seat, color, soft }`, where `color`/`soft`
 * are CSS `var(--seat-N*)` strings. Seats are assigned over the active council
 * (`config.council_models`); a non-council id falls back to its raw hashed seat
 * so any model still renders a stable color.
 *
 * @param {string[]} [councilIdsOverride] - optional explicit roster (e.g. a
 *   conversation's own council) instead of the live config.
 */
export function useSeatColors(councilIdsOverride) {
  const configQuery = useConfig();
  const councilIds = councilIdsOverride ?? configQuery.data?.council_models ?? EMPTY_IDS;

  const seatMap = useMemo(() => assignSeats(councilIds), [councilIds]);

  return useMemo(
    () => ({
      seatMap,
      seatOf(modelId) {
        if (modelId == null) return seatTokens(1);
        const key = String(modelId);
        return seatMap.get(key) ?? seatTokens(rawSeat(key));
      },
    }),
    [seatMap]
  );
}
