import { api } from './client';
import type { BeanMenuField, Menu, MenuItemType, PublicMenu } from './types';

// docs/api/menu.md §7b: the menu builder. Every write returns the whole menu.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/menu`;

export interface MenuItemInput {
  name?: string | null; // null/'' = the source's own
  description?: string | null;
  price?: number | null; // needs the menu's currency
  available?: boolean;
  beanFields?: BeanMenuField[] | null; // the beans block only; null = all
}

export type NewMenuItem = MenuItemInput & { itemType: MenuItemType; drinkId?: string; brewerId?: string };

export const menuApi = {
  get: (workspaceId: string) => api.get<Menu>(base(workspaceId)),
  // The guest page (docs/api/public-menu.md §7): no login; 404 when off or unknown.
  publicMenu: (slug: string) => api.get<PublicMenu>(`/api/public/menu/${encodeURIComponent(slug)}`),
  // As guests would see it (the public menu's shape), even while it's off.
  preview: (workspaceId: string) => api.get<PublicMenu>(`${base(workspaceId)}/preview`),
  setCurrency: (workspaceId: string, currency: string | null) => api.patch<Menu>(base(workspaceId), { currency }),
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
};
