import { api } from './client';
import type { Bean, BeanProcess, BlendType, DetailedRoastLevel, RoastLevel, RoastType } from './types';

// Request body for create/update (docs/api/beans.md §4). roastLevel is
// normally left out: the API derives it from detailedRoastLevel. Only a copy
// of an older bean with a 5-step level and no roast name sends it.
export interface BeanInput {
  roasterName: string;
  beanName: string;
  process: BeanProcess | null;
  roastLevel?: RoastLevel | null;
  roastDate: string | null; // YYYY-MM-DD
  inventoryWeightGrams: number;
  showOnPublicMenu: boolean;
  roastType: RoastType | null;
  detailedRoastLevel: DetailedRoastLevel | null;
  blendType: BlendType | null;
  decaf: boolean;
  website: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  bagWeightGrams: number | null;
  notes: string | null;
  flavorProfile: string | null;
  region: string | null;
  altitudeMasl: number | null;
  producer: string | null;
  purchaseDate: string | null;
  greenSupplier: string | null;
  rating: number | null;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/beans`;

export const beansApi = {
  list: (workspaceId: string) => api.get<{ beans: Bean[] }>(base(workspaceId)),
  create: (workspaceId: string, input: BeanInput) => api.post<{ bean: Bean }>(base(workspaceId), input),
  // archived: true archives (keeping the first date), false restores (§4).
  update: (workspaceId: string, id: string, input: Partial<BeanInput> & { archived?: boolean }) =>
    api.patch<{ bean: Bean }>(`${base(workspaceId)}/${id}`, input),
  // date: the user's local YYYY-MM-DD (§4).
  freeze: (workspaceId: string, id: string, date: string) =>
    api.post<{ bean: Bean }>(`${base(workspaceId)}/${id}/freeze`, { date }),
  thaw: (workspaceId: string, id: string, date: string) =>
    api.post<{ bean: Bean }>(`${base(workspaceId)}/${id}/thaw`, { date }),
  // Correct the latest freeze period: its dates, or thawedOn null to un-thaw (§4).
  editLatestFreeze: (workspaceId: string, id: string, input: { frozenOn?: string; thawedOn?: string | null }) =>
    api.patch<{ bean: Bean }>(`${base(workspaceId)}/${id}/freezes/latest`, input),
  removeLatestFreeze: (workspaceId: string, id: string) => api.delete<{ bean: Bean }>(`${base(workspaceId)}/${id}/freezes/latest`),
  // Without deleteBrewLogs, a bean with brew logs answers 409 + brewLogCount.
  remove: (workspaceId: string, id: string, deleteBrewLogs = false) =>
    api.delete(`${base(workspaceId)}/${id}${deleteBrewLogs ? '?deleteBrewLogs=true' : ''}`),
};
