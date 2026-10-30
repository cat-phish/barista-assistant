import { createRouter, createWebHistory, type RouteLocationRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';
import { lastMode, lastPage, rememberPage } from '../lib/mode';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean; // the guest menu page: no login, no session check (works offline)
    requiresAuth?: boolean;
    requiresWorkspace?: boolean; // implies requiresAuth
    guestOnly?: boolean; // login/register: logged-in users go home
    requiresEditor?: boolean; // owner or barista in the current workspace (viewers are read-only)
    requiresAdmin?: boolean; // a server admin (granted on the server); implies requiresAuth
    requiresRoasting?: boolean; // roast mode: the workspace has home roasting on (docs/api/workspaces.md §2)
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The landing page: roast mode if this device was last in it (lib/mode.ts),
    // else Brew, or the Journal for a viewer (who can't log brews).
    // Kept as a route so pushes to 'home' land in the right place.
    {
      path: '/',
      name: 'home',
      component: () => import('../views/BrewView.vue'),
      meta: { requiresAuth: true, requiresWorkspace: true },
      beforeEnter: () => {
        const workspaces = useWorkspaceStore();
        const ws = workspaces.current;
        if (ws?.settings.homeRoasting && lastMode(ws.id) === 'roast') return lastPage(ws.id, 'roast') ?? { name: 'roast-home' };
        return { name: workspaces.canEdit ? 'brew' : 'journal' };
      },
    },
    { path: '/menu/:slug', name: 'public-menu', component: () => import('../views/PublicMenuView.vue'), props: true, meta: { public: true } },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { guestOnly: true } },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { guestOnly: true } },
    { path: '/workspaces', name: 'workspaces', component: () => import('../views/WorkspacesView.vue'), meta: { requiresAuth: true } },
    { path: '/brew', name: 'brew', component: () => import('../views/BrewView.vue'), meta: { requiresWorkspace: true } },
    { path: '/journal', name: 'journal', component: () => import('../views/JournalView.vue'), meta: { requiresWorkspace: true } },
    { path: '/journal/:id', name: 'journal-entry', component: () => import('../views/JournalEntryView.vue'), props: true, meta: { requiresWorkspace: true } },
    // Insights (Stats in code): one view holding the filters and data, a child route per tab (components/StatsTabs.vue).
    {
      path: '/insights',
      component: () => import('../views/StatsView.vue'),
      meta: { requiresWorkspace: true },
      children: [
        { path: '', name: 'stats', redirect: (to) => ({ name: 'stats-overview', query: to.query }) },
        { path: 'overview', name: 'stats-overview', component: () => import('../views/stats/StatsOverviewView.vue') },
        { path: 'brews', name: 'stats-brews', component: () => import('../views/stats/StatsBrewsView.vue') },
        { path: 'beans', name: 'stats-beans', component: () => import('../views/stats/StatsBeansView.vue') },
        { path: 'methods', name: 'stats-methods', component: () => import('../views/stats/StatsMethodsView.vue') },
        { path: 'recipes', name: 'stats-recipes', component: () => import('../views/stats/StatsRecipesView.vue') },
        { path: 'prep', name: 'stats-tools', component: () => import('../views/stats/StatsToolsView.vue') },
        { path: 'grinders', name: 'stats-grinders', component: () => import('../views/stats/StatsGrindersView.vue') },
        { path: 'explore', name: 'stats-explore', component: () => import('../views/stats/StatsExploreView.vue') },
      ],
    },
    // Roast mode (docs/roadmap.md, Home roasting): its own tabs in the header.
    // /roast lands on the Roast form, or the roast history for a viewer.
    {
      path: '/roast',
      name: 'roast-home',
      component: () => import('../views/RoastsView.vue'),
      meta: { requiresWorkspace: true, requiresRoasting: true },
      beforeEnter: () => ({ name: useWorkspaceStore().canEdit ? 'roast-new' : 'roasts' }),
    },
    { path: '/roast/new', name: 'roast-new', component: () => import('../views/RoastFormView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true, requiresEditor: true } },
    { path: '/roast/roasts', name: 'roasts', component: () => import('../views/RoastsView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true } },
    { path: '/roast/roasts/:id', name: 'roast', component: () => import('../views/RoastView.vue'), props: true, meta: { requiresWorkspace: true, requiresRoasting: true } },
    { path: '/roast/roasts/:id/edit', name: 'roast-edit', component: () => import('../views/RoastFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresRoasting: true, requiresEditor: true } },
    { path: '/roast/green', name: 'green-coffees', component: () => import('../views/GreenView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true } },
    { path: '/roast/green/new', name: 'green-coffee-new', component: () => import('../views/GreenFormView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true, requiresEditor: true } },
    { path: '/roast/green/:id/edit', name: 'green-coffee-edit', component: () => import('../views/GreenFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresRoasting: true, requiresEditor: true } },
    { path: '/roast/resting', name: 'resting', component: () => import('../views/RestingView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true } },
    { path: '/roast/setup', name: 'roasting-machines', component: () => import('../views/RoastersView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true } },
    { path: '/roast/setup/new', name: 'roasting-machine-new', component: () => import('../views/RoasterFormView.vue'), meta: { requiresWorkspace: true, requiresRoasting: true, requiresEditor: true } },
    { path: '/roast/setup/:id/edit', name: 'roasting-machine-edit', component: () => import('../views/RoasterFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresRoasting: true, requiresEditor: true } },
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
    { path: '/setup/tools/new', name: 'prep-tool-new', component: () => import('../views/PrepToolFormView.vue'), meta: { requiresWorkspace: true, requiresEditor: true } },
    { path: '/setup/tools/:id/edit', name: 'prep-tool-edit', component: () => import('../views/PrepToolFormView.vue'), props: true, meta: { requiresWorkspace: true, requiresEditor: true } },
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
    { path: '/settings/brew-setup', name: 'settings-brew-setup', component: () => import('../views/SettingsBrewSetupView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/repeat', redirect: { name: 'settings-brew-setup' } }, // its old name, Repeat brews
    { path: '/settings/ai-prompt', name: 'settings-ai-prompt', component: () => import('../views/SettingsPromptView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/notifications', name: 'settings-notifications', component: () => import('../views/SettingsNotificationsView.vue'), meta: { requiresAuth: true } },
    { path: '/settings/lists', name: 'settings-lists', component: () => import('../views/SettingsListsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/defaults', name: 'settings-defaults', component: () => import('../views/SettingsDefaultsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/fields', name: 'settings-fields', component: () => import('../views/SettingsFieldsView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/ai', name: 'settings-ai', component: () => import('../views/SettingsAiView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/workspace', name: 'settings-workspace', component: () => import('../views/SettingsWorkspaceView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/members', name: 'settings-members', component: () => import('../views/SettingsMembersView.vue'), meta: { requiresWorkspace: true } },
    { path: '/settings/server', name: 'settings-server', component: () => import('../views/SettingsServerView.vue'), meta: { requiresAdmin: true } },
    { path: '/settings/data', name: 'settings-data', component: () => import('../views/SettingsDataView.vue'), meta: { requiresWorkspace: true } },
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
  if ((to.meta.requiresAuth || to.meta.requiresWorkspace || to.meta.requiresAdmin) && !auth.user) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !auth.user?.isAdmin) return { name: 'settings-account' };
  if (to.meta.requiresWorkspace) {
    const workspaces = useWorkspaceStore();
    await workspaces.ensureLoaded();
    if (!workspaces.current) return { name: 'workspaces' };
    // Roasting turned off (or another workspace): back to brew mode.
    if (to.meta.requiresRoasting && !workspaces.current.settings.homeRoasting) return { name: 'home' };
    // Viewers following an edit link land on the read-only list instead.
    if (to.meta.requiresEditor && !workspaces.canEdit) {
      if (to.path.startsWith('/roast/')) return { name: to.path.startsWith('/roast/setup') ? 'roasting-machines' : to.path.startsWith('/roast/green') ? 'green-coffees' : 'roasts' };
      return to.path.startsWith('/recipes') ? { name: 'recipes' } : { name: 'beans' };
    }
  }
  return true;
});

// The mode's last page, for the Brew | Roast switch and the next app start
// (lib/mode.ts). Forms aren't remembered (the switch goes back to their
// list), and neither is Settings, which belongs to both modes.
router.afterEach((to, _from, failure) => {
  if (failure || !to.meta.requiresWorkspace || to.meta.requiresEditor || to.name === 'home' || to.path.startsWith('/settings')) return;
  const ws = useWorkspaceStore().current;
  if (ws) rememberPage(ws.id, to.fullPath);
});
