import { createRouter, createWebHistory, type RouteLocationRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiresWorkspace?: boolean; // implies requiresAuth
    guestOnly?: boolean; // login/register: logged-in users go home
    requiresEditor?: boolean; // owner or barista in the current workspace (viewers are read-only)
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { requiresAuth: true, requiresWorkspace: true } },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { guestOnly: true } },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { guestOnly: true } },
    { path: '/workspaces', name: 'workspaces', component: () => import('../views/WorkspacesView.vue'), meta: { requiresAuth: true } },
    { path: '/brew', name: 'brew', component: () => import('../views/BrewView.vue'), meta: { requiresWorkspace: true } },
    { path: '/journal', name: 'journal', component: () => import('../views/JournalView.vue'), meta: { requiresWorkspace: true } },
    { path: '/journal/:id', name: 'journal-entry', component: () => import('../views/JournalEntryView.vue'), props: true, meta: { requiresWorkspace: true } },
    // Equipment: three tabs (components/EquipmentTabs.vue). /grinders is the old address.
    { path: '/equipment', redirect: '/equipment/brewers' },
    { path: '/grinders', redirect: '/equipment/grinders' },
    { path: '/equipment/grinders', name: 'grinders', component: () => import('../views/GrindersView.vue'), meta: { requiresWorkspace: true } },
    { path: '/equipment/brewers', name: 'brewers', component: () => import('../views/BrewersView.vue'), meta: { requiresWorkspace: true } },
    // Brew methods and espresso machines merged into brewers.
    { path: '/equipment/machines', redirect: '/equipment/brewers' },
    { path: '/equipment/methods', redirect: '/equipment/brewers' },
    { path: '/beans', name: 'beans', component: () => import('../views/BeansView.vue'), meta: { requiresWorkspace: true } },
    { path: '/beans/new', name: 'bean-new', component: () => import('../views/BeanFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/beans/:id/edit', name: 'bean-edit', component: () => import('../views/BeanFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/recipes', name: 'recipes', component: () => import('../views/RecipesView.vue'), meta: { requiresWorkspace: true } },
    { path: '/recipes/new', name: 'recipe-new', component: () => import('../views/RecipeFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    // Drinks and ingredients share the Recipes section (components/MenuTabs.vue).
    { path: '/drinks', name: 'drinks', component: () => import('../views/DrinksView.vue'), meta: { requiresWorkspace: true } },
    { path: '/drinks/new', name: 'drink-new', component: () => import('../views/DrinkFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/drinks/:id/edit', name: 'drink-edit', component: () => import('../views/DrinkFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/ingredients', name: 'ingredients', component: () => import('../views/IngredientsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/recipes/:id/edit', name: 'recipe-edit', component: () => import('../views/RecipeFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

// Only same-app paths, so ?redirect= can't send someone to another site.
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/';
}

router.beforeEach(async (to): Promise<RouteLocationRaw | true> => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.fetchMe();

  if (to.meta.guestOnly && auth.user) return safeRedirect(to.query.redirect);
  if ((to.meta.requiresAuth || to.meta.requiresWorkspace) && !auth.user) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  if (to.meta.requiresWorkspace) {
    const workspaces = useWorkspaceStore();
    await workspaces.ensureLoaded();
    if (!workspaces.current) return { name: 'workspaces' };
    // Viewers following an edit link land on the read-only list instead.
    if (to.meta.requiresEditor && !workspaces.canEdit) return to.path.startsWith('/recipes') ? { name: 'recipes' } : { name: 'beans' };
  }
  return true;
});
