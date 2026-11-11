import { api, API_URL } from './client';
import type { Usage } from '../lib/deleting';
import type { BeanBatchMode, BeanMenuField, Menu, MenuItemType, MenuSize, PublicMenu } from './types';

// docs/api/menu.md §7b: the menu builder. Every write returns the whole menu.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/menu`;

export interface MenuItemInput {
  name?: string | null; // null/'' = the source's own
  description?: string | null;
  price?: number | null; // needs the menu's currency
  available?: boolean;
  beanFields?: BeanMenuField[] | null; // the beans block only; null = all
  beanBatches?: BeanBatchMode | null; // the beans block only; null = 'each'
  showMethod?: boolean | null; // drinks and brewers; null = the menu's default
  showIngredients?: boolean | null;
  sizes?: MenuSize[] | null; // a price per size; never with price
}

export type NewMenuItem = MenuItemInput & { itemType: MenuItemType; drinkId?: string; brewerId?: string; otherItemId?: string };

export const menuApi = {
  get: (workspaceId: string) => api.get<Menu>(base(workspaceId)),
  // The guest page (docs/api/public-menu.md §7): no login; 404 when off or unknown.
  publicMenu: (slug: string) => api.get<PublicMenu>(`/api/public/menu/${encodeURIComponent(slug)}`),
  // As guests would see it (the public menu's shape), even while it's off.
  preview: (workspaceId: string) => api.get<PublicMenu>(`${base(workspaceId)}/preview`),
  setCurrency: (workspaceId: string, currency: string | null) => api.patch<Menu>(base(workspaceId), { currency }),
  // The public menu's heading; null/'' = the workspace name.
  setTitle: (workspaceId: string, title: string | null) => api.patch<Menu>(base(workspaceId), { title }),
  // What items show under them by default (each item can override it).
  setDisplay: (workspaceId: string, display: { showMethod?: boolean; showIngredients?: boolean }) => api.patch<Menu>(base(workspaceId), display),
  // Branding: accent colour ("#rrggbb") and a line under the title; null = none.
  setBranding: (workspaceId: string, branding: { accentColor?: string | null; tagline?: string | null }) => api.patch<Menu>(base(workspaceId), branding),
  // Logos, in order: the first is the one the menu shows (at most 6).
  addLogo: (workspaceId: string, image: Blob) => api.post<Menu>(`${base(workspaceId)}/logos`, image),
  reorderLogos: (workspaceId: string, logoIds: string[]) => api.put<Menu>(`${base(workspaceId)}/logos/order`, { logoIds }),
  // A cropped image in its place, under a new id.
  replaceLogo: (workspaceId: string, logoId: string, image: Blob) => api.put<Menu>(`${base(workspaceId)}/logos/${logoId}/image`, image),
  removeLogo: (workspaceId: string, logoId: string) => api.delete<Menu>(`${base(workspaceId)}/logos/${logoId}`),
  // A logo's image (public: the guest menu shows the first).
  logoUrl: (slug: string, logoId: string) => `${API_URL}/api/public/menu/${encodeURIComponent(slug)}/logo/${logoId}`,
  addSection: (workspaceId: string, name: string, description: string | null = null) =>
    api.post<Menu>(`${base(workspaceId)}/sections`, { name, description }),
  updateSection: (workspaceId: string, id: string, input: { name?: string; description?: string | null }) =>
    api.patch<Menu>(`${base(workspaceId)}/sections/${id}`, input),
  // Deletes its items too.
  removeSection: (workspaceId: string, id: string) => api.delete<Menu>(`${base(workspaceId)}/sections/${id}`),
  // Every section once, in order, each with every one of its items in order.
  layout: (workspaceId: string, sections: Array<{ id: string; itemIds: string[] }>) => api.put<Menu>(`${base(workspaceId)}/layout`, { sections }),
  addItem: (workspaceId: string, sectionId: string, input: NewMenuItem) =>
    api.post<Menu>(`${base(workspaceId)}/sections/${sectionId}/items`, input),
  // Several at once, last in the order given; all or nothing.
  addItems: (workspaceId: string, sectionId: string, items: NewMenuItem[]) =>
    api.post<Menu>(`${base(workspaceId)}/sections/${sectionId}/items`, { items }),
  updateItem: (workspaceId: string, id: string, input: MenuItemInput) => api.patch<Menu>(`${base(workspaceId)}/items/${id}`, input),
  removeItem: (workspaceId: string, id: string) => api.delete<Menu>(`${base(workspaceId)}/items/${id}`),
  // Other items (the list comes with the menu); deleting one takes it off every section.
  addOtherItem: (workspaceId: string, input: { name: string; description: string | null }) => api.post<Menu>(`${base(workspaceId)}/other-items`, input),
  updateOtherItem: (workspaceId: string, id: string, input: { name?: string; description?: string | null }) =>
    api.patch<Menu>(`${base(workspaceId)}/other-items/${id}`, input),
  removeOtherItem: (workspaceId: string, id: string) => api.delete<Menu>(`${base(workspaceId)}/other-items/${id}`),
  otherItemUsage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/other-items/${id}/usage`),
};
