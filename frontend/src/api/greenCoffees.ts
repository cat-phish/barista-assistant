import { api } from './client';
import type { Usage } from '../lib/deleting';
import type { GreenCoffee, GreenCoffeeInput } from './types';

// docs/api/green-coffees.md §4e. Listing is for any member; changes are for
// owners and baristas.
const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/green-coffees`;

export const greenCoffeesApi = {
  list: (workspaceId: string) => api.get<{ greenCoffees: GreenCoffee[] }>(base(workspaceId)),
  create: (workspaceId: string, input: GreenCoffeeInput) => api.post<{ greenCoffee: GreenCoffee }>(base(workspaceId), input),
  update: (workspaceId: string, id: string, input: Partial<GreenCoffeeInput> & { archived?: boolean }) =>
    api.patch<{ greenCoffee: GreenCoffee }>(`${base(workspaceId)}/${id}`, input),
  // What a delete would unlink (README, "Archiving and deleting").
  usage: (workspaceId: string, id: string) => api.get<Usage>(`${base(workspaceId)}/${id}/usage`),
  remove: (workspaceId: string, id: string) => api.delete(`${base(workspaceId)}/${id}`),
};
