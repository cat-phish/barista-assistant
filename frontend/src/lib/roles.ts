import type { Role } from '../api/types';

export const ROLES: Role[] = ['owner', 'barista', 'viewer'];
export const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', barista: 'Barista', viewer: 'Viewer' };
// What each role can do (docs/api/README.md §0), shown where roles are chosen.
export const ROLE_HINTS: Record<Role, string> = {
  owner: 'Everything, including settings, members and deleting the workspace.',
  barista: 'Logs brews and edits beans, recipes, equipment and the menu.',
  viewer: 'Sees everything, changes nothing.',
};
