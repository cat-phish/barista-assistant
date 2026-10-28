import { api, API_URL } from './client';
import type { Bean, BeanPhoto, BlendType, LabelFields, DetailedRoastLevel, OriginArea, RoastLevel, RoastType } from './types';

// Request body for create/update (docs/api/beans.md §4). With roast names,
// roastLevel is left out: the API derives it from detailedRoastLevel (only a
// copy of a bean with a 5-step level and no name sends it). Light to dark
// (settings.roastScale "levels") sends roastLevel with a null name.
export interface BeanInput {
  roasterName: string;
  beanName: string;
  processId: string | null;
  roastLevel?: RoastLevel | null;
  roastDate: string | null; // YYYY-MM-DD
  inventoryWeightGrams: number;
  showOnPublicMenu: boolean;
  roastType: RoastType | null;
  detailedRoastLevel?: DetailedRoastLevel | null;
  blendType: BlendType | null;
  decaf: boolean;
  website: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  bagWeightGrams: number | null;
  roastWeightLossPercent: number | null;
  notes: string | null;
  flavorProfile: string | null;
  originArea: OriginArea | null;
  country: string | null;
  region: string | null;
  altitudeMasl: number | null;
  producer: string | null;
  purchaseDate: string | null;
  greenSupplier: string | null;
  batchNumber: string | null;
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
  // Photos (docs/api/bean-photos.md §4c): any image; the server resizes it
  // and strips EXIF. 400 not an image, 413 over 15 MB, 409 the bean is full.
  addPhoto: (workspaceId: string, beanId: string, image: Blob) => api.post<{ photo: BeanPhoto }>(`${base(workspaceId)}/${beanId}/photos`, image),
  makeCover: (workspaceId: string, beanId: string, photoId: string) =>
    api.patch<{ photos: BeanPhoto[] }>(`${base(workspaceId)}/${beanId}/photos/${photoId}`, { cover: true }),
  removePhoto: (workspaceId: string, beanId: string, photoId: string) => api.delete(`${base(workspaceId)}/${beanId}/photos/${photoId}`),
  photoUrl: (workspaceId: string, beanId: string, photoId: string) => `${API_URL}${base(workspaceId)}/${beanId}/photos/${photoId}`,
  // Reads the label off 1–6 photos, base64 (docs/api/bean-label.md §4d). Can
  // take half a minute; 403 when the workspace has it off.
  readLabel: (workspaceId: string, images: string[]) => api.post<{ fields: LabelFields }>(`/api/workspaces/${workspaceId}/bean-label`, { images }),
};
