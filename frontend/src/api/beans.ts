import { api } from './client';
import type { Bean, BeanProcess, BlendType, DetailedRoastLevel, RoastType } from './types';

// Request body for create/update (docs/api/beans.md §4). roastLevel isn't
// sent: the API derives it from detailedRoastLevel.
export interface BeanInput {
  roasterName: string;
  beanName: string;
  process: BeanProcess | null;
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
  update: (workspaceId: string, id: string, input: Partial<BeanInput>) =>
    api.patch<{ bean: Bean }>(`${base(workspaceId)}/${id}`, input),
  // date: the user's local YYYY-MM-DD (§4).
  freeze: (workspaceId: string, id: string, date: string) =>
    api.post<{ bean: Bean }>(`${base(workspaceId)}/${id}/freeze`, { date }),
  thaw: (workspaceId: string, id: string, date: string) =>
    api.post<{ bean: Bean }>(`${base(workspaceId)}/${id}/thaw`, { date }),
  // Without deleteBrewLogs, a bean with brew logs answers 409 + brewLogCount.
  remove: (workspaceId: string, id: string, deleteBrewLogs = false) =>
    api.delete(`${base(workspaceId)}/${id}${deleteBrewLogs ? '?deleteBrewLogs=true' : ''}`),
};
