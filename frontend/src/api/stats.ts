import { api } from './client';
import type { StatsData } from './types';

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
};
