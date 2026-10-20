import { api } from './client';
import type { Component, ComponentType } from './types';

// docs/api_spec.md §5b
export interface ComponentInput {
  name: string;
  componentType: ComponentType;
  instructions: string | null;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/components`;

export const componentsApi = {
  list: (workspaceId: string) => api.get<{ components: Component[] }>(base(workspaceId)),
  create: (workspaceId: string, input: ComponentInput) => api.post<{ component: Component }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<ComponentInput>) =>
    api.patch<{ component: Component }>(`${base(workspaceId)}/${id}`, input),
  // 409 + drinkCount while drinks use it.
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};
