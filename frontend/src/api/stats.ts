import { api } from './client';
import type { InsightChart, InsightLayout, StatsData } from './types';

// docs/api/stats.md §11. Dates are local YYYY-MM-DD, both inclusive.
export interface StatsQuery {
  from?: string;
  to?: string;
  beanId?: string;
  recipeId?: string;
  brewerId?: string;
  mine?: boolean;
}

export const statsApi = {
  get(workspaceId: string, query: StatsQuery = {}) {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.beanId) params.set('beanId', query.beanId);
    if (query.recipeId) params.set('recipeId', query.recipeId);
    if (query.brewerId) params.set('brewerId', query.brewerId);
    if (query.mine) params.set('mine', '1');
    const qs = params.toString();
    return api.get<StatsData>(`/api/workspaces/${workspaceId}/stats${qs ? `?${qs}` : ''}`);
  },
  // §11b: the caller's own added charts and layout; each PUT replaces its part.
  charts(workspaceId: string) {
    return api.get<{ charts: InsightChart[]; layout: InsightLayout }>(`/api/workspaces/${workspaceId}/stats/charts`);
  },
  saveLayout(workspaceId: string, layout: InsightLayout) {
    return api.put<{ layout: InsightLayout }>(`/api/workspaces/${workspaceId}/stats/layout`, { layout });
  },
  saveCharts(workspaceId: string, charts: InsightChart[]) {
    return api.put<{ charts: InsightChart[] }>(`/api/workspaces/${workspaceId}/stats/charts`, { charts });
  },
};
