// A brewer's measured brews, for the grounds retention it's learned from
// (docs/api/brewers.md §3, "Grounds retention"): any bean or recipe, the
// latest ones with a water weight and a measured yield (so no espresso shots).
import { brewLogsApi } from '../api/brews';
import type { BrewLog } from '../api/types';
import type { MeasuredBrew } from './scale';

// How many of the brewer's latest measured brews count.
export const BREWER_SAMPLE = 20;

export function toMeasured(logs: Pick<BrewLog, 'actualDoseGrams' | 'actualWaterGrams' | 'actualIceGrams' | 'actualYieldGrams'>[]): MeasuredBrew[] {
  return logs.flatMap((l) =>
    l.actualWaterGrams !== null && l.actualYieldGrams !== null
      ? [{ actualDoseGrams: l.actualDoseGrams, actualWaterGrams: l.actualWaterGrams, actualIceGrams: l.actualIceGrams, actualYieldGrams: l.actualYieldGrams }]
      : [],
  );
}

// [] when it can't load: the estimate falls back to the roast default.
export async function loadBrewerMeasured(workspaceId: string, brewerId: string): Promise<MeasuredBrew[]> {
  try {
    const { brewLogs } = await brewLogsApi.list(workspaceId, { brewerId, limit: 50 });
    return toMeasured(brewLogs).slice(0, BREWER_SAMPLE);
  } catch {
    return [];
  }
}
