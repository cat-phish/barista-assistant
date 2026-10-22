import { api } from './client';
import type { Menu, MenuItemType } from './types';

// docs/api/menu.md §7b: the menu builder. Every write returns the whole menu.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/menu`;

export interface MenuItemInput {
  name?: string | null; // null/'' = the source's own
  description?: string | null;
  price?: number | null; // needs the menu's currency
  available?: boolean;
}

export const menuApi = {
  get: (workspaceId: string) => api.get<Menu>(base(workspaceId)),
  setCurrency: (workspaceId: string, currency: string | null) => api.patch<Menu>(base(workspaceId), { currency }),
  addSection: (workspaceId: string, name: string, description: string | null = null) =>
    api.post<Menu>(`${base(workspaceId)}/sections`, { name, description }),
  updateSection: (workspaceId: string, id: string, input: { name?: string; description?: string | null }) =>
    api.patch<Menu>(`${base(workspaceId)}/sections/${id}`, input),
  // Deletes its items too.
  removeSection: (workspaceId: string, id: string) => api.delete<Menu>(`${base(workspaceId)}/sections/${id}`),
  // Every section once, in order, each with every one of its items in order.
  layout: (workspaceId: string, sections: Array<{ id: string; itemIds: string[] }>) => api.put<Menu>(`${base(workspaceId)}/layout`, { sections }),
  addItem: (workspaceId: string, sectionId: string, input: MenuItemInput & { itemType: MenuItemType; drinkId?: string; brewerId?: string }) =>
    api.post<Menu>(`${base(workspaceId)}/sections/${sectionId}/items`, input),
  updateItem: (workspaceId: string, id: string, input: MenuItemInput) => api.patch<Menu>(`${base(workspaceId)}/items/${id}`, input),
  removeItem: (workspaceId: string, id: string) => api.delete<Menu>(`${base(workspaceId)}/items/${id}`),
};
