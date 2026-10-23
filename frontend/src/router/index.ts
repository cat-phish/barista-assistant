import { createRouter, createWebHistory, type RouteLocationRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean; // the guest menu page: no login, no session check (works offline)
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
    { path: '/menu/:slug', name: 'public-menu', component: () => import('../views/PublicMenuView.vue'), props: true, meta: { public: true } },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { guestOnly: true } },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { guestOnly: true } },
    { path: '/workspaces', name: 'workspaces', component: () => import('../views/WorkspacesView.vue'), meta: { requiresAuth: true } },
    { path: '/brew', name: 'brew', component: () => import('../views/BrewView.vue'), meta: { requiresWorkspace: true } },
    { path: '/journal', name: 'journal', component: () => import('../views/JournalView.vue'), meta: { requiresWorkspace: true } },
    { path: '/journal/:id', name: 'journal-entry', component: () => import('../views/JournalEntryView.vue'), props: true, meta: { requiresWorkspace: true } },
    // Bar setup: three tabs (components/SetupTabs.vue).
    { path: '/setup', redirect: '/setup/brewers' },
    { path: '/setup/brewers', name: 'brewers', component: () => import('../views/BrewersView.vue'), meta: { requiresWorkspace: true } },
    { path: '/setup/brewers/new', name: 'brewer-new', component: () => import('../views/BrewerFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/brewers/:id/edit', name: 'brewer-edit', component: () => import('../views/BrewerFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/grinders', name: 'grinders', component: () => import('../views/GrindersView.vue'), meta: { requiresWorkspace: true } },
    { path: '/setup/grinders/new', name: 'grinder-new', component: () => import('../views/GrinderFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/grinders/:id/edit', name: 'grinder-edit', component: () => import('../views/GrinderFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/water', name: 'water-profiles', component: () => import('../views/WaterProfilesView.vue'), meta: { requiresWorkspace: true } },
    { path: '/setup/water/new', name: 'water-profile-new', component: () => import('../views/WaterProfileFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/water/:id/edit', name: 'water-profile-edit', component: () => import('../views/WaterProfileFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/tools', name: 'prep-tools', component: () => import('../views/PrepToolsView.vue'), meta: { requiresWorkspace: true } },
    // Categories moved to the Drinks page; old links and bookmarks still land there.
    { path: '/setup/categories', name: 'categories', redirect: { name: 'drinks', hash: '#categories' } },
    { path: '/setup/menu', name: 'menu-builder', component: () => import('../views/MenuBuilderView.vue'), meta: { requiresWorkspace: true } },
    // Old addresses: Equipment became Bar setup; methods and machines became brewers.
    { path: '/equipment', redirect: '/setup/brewers' },
    { path: '/grinders', redirect: '/setup/grinders' },
    { path: '/equipment/grinders', redirect: '/setup/grinders' },
    { path: '/equipment/brewers', redirect: '/setup/brewers' },
    { path: '/equipment/machines', redirect: '/setup/brewers' },
    { path: '/equipment/methods', redirect: '/setup/brewers' },
    // Settings: grouped tabs (components/SettingsNav.vue).
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/account', name: 'settings-account', component: () => import('../views/SettingsAccountView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/preferences', name: 'settings-preferences', component: () => import('../views/SettingsPreferencesView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/repeat', name: 'settings-repeat', component: () => import('../views/SettingsRepeatView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/notifications', name: 'settings-notifications', component: () => import('../views/SettingsNotificationsView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/lists', name: 'settings-lists', component: () => import('../views/SettingsListsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/defaults', name: 'settings-defaults', component: () => import('../views/SettingsDefaultsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/fields', name: 'settings-fields', component: () => import('../views/SettingsFieldsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/workspace', name: 'settings-workspace', component: () => import('../views/SettingsWorkspaceView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/members', name: 'settings-members', component: () => import('../views/SettingsMembersView.vue'), meta: { requiresWorkspace: true } },
    { path: '/beans', name: 'beans', component: () => import('../views/BeansView.vue'), meta: { requiresWorkspace: true } },
    { path: '/beans/archived', name: 'beans-archived', component: () => import('../views/BeansView.vue'), props: { archived: true }, meta: { requiresWorkspace: true } },
    { path: '/beans/new', name: 'bean-new', component: () => import('../views/BeanFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/beans/:id/edit', name: 'bean-edit', component: () => import('../views/BeanFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/recipes', name: 'recipes', component: () => import('../views/RecipesView.vue'), meta: { requiresWorkspace: true } },
    { path: '/recipes/new', name: 'recipe-new', component: () => import('../views/RecipeFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    // Drinks and ingredients share the Recipes section (components/MenuTabs.vue).
    { path: '/drinks', name: 'drinks', component: () => import('../views/DrinksView.vue'), meta: { requiresWorkspace: true } },
    { path: '/drinks/new', name: 'drink-new', component: () => import('../views/DrinkFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/drinks/:id/edit', name: 'drink-edit', component: () => import('../views/DrinkFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/ingredients', name: 'ingredients', component: () => import('../views/IngredientsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/ingredients/new', name: 'ingredient-new', component: () => import('../views/IngredientFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/ingredients/:id/edit', name: 'ingredient-edit', component: () => import('../views/IngredientFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
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
  if (to.meta.public) return true;
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
