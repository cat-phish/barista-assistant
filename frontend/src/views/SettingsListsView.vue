<script setup lang="ts">
// Settings → Lists: the workspace's editable lists (roadmap, editable lists): brewer
// methods, bean processes, recipe styles (a list per method behaviour),
// brew problems and the flavor wheel.
import { computed, onMounted, ref } from 'vue';
import { beanProcessesApi } from '../api/beanProcesses';
import { errorMessage } from '../api/client';
import { recipeStylesApi } from '../api/recipeStyles';
import { brewerMethodsApi } from '../api/brewerMethods';
import { brewProblemsApi } from '../api/brewProblems';
import type { BeanProcess, BrewerMethod, BrewProblem, MethodKind, RecipeStyle, RecipeStyleItem } from '../api/types';
import { METHOD_KINDS, METHOD_ORDER, RECIPE_STYLES, STYLES_BY_KIND } from '../lib/equipment';
import { methodLabel } from '../lib/prepTools';
import EditableList, { type ListApi } from '../components/EditableList.vue';
import ListDataBar from '../components/ListDataBar.vue';
import FlavorLexiconCard from '../components/FlavorLexiconCard.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const processes = ref<BeanProcess[]>([]);
const styles = ref<RecipeStyleItem[]>([]);
const methods = ref<BrewerMethod[]>([]);
const problems = ref<BrewProblem[]>([]);
const problemBusy = ref(false);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [p, s, m, bp] = await Promise.all([beanProcessesApi.list(ws), recipeStylesApi.list(ws), brewerMethodsApi.list(ws), brewProblemsApi.list(ws)]);
    methods.value = m.methods;
    problems.value = bp.problems;
    processes.value = p.processes;
    styles.value = s.styles;
    error.value = '';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const processApi: ListApi = {
  create: beanProcessesApi.create,
  update: beanProcessesApi.update,
  reorder: beanProcessesApi.reorder,
  usage: beanProcessesApi.usage,
  remove: beanProcessesApi.remove,
};

// Brewer methods (docs/api/brewer-methods.md §3e): a custom one works like
// a built-in, which decides its brewers' fields and timer. Changing that is
// refused (409) once recipes use its brewers.
const methodEntries = computed(() => methods.value.map((m) => ({ ...m, choice: m.behaviour })));
const behaviourChoices = METHOD_ORDER.map((k) => ({ value: k, label: METHOD_KINDS[k].label }));
const methodApi: ListApi = {
  create: (ws, name, choice) => brewerMethodsApi.create(ws, name, (choice ?? 'filter') as MethodKind),
  update: (ws, id, { choice, ...rest }) => brewerMethodsApi.update(ws, id, { ...rest, ...(choice ? { behaviour: choice as MethodKind } : {}) }),
  reorder: brewerMethodsApi.reorder,
  usage: brewerMethodsApi.usage,
  remove: brewerMethodsApi.remove,
};

// Brew problems (docs/api/brew-problems.md §6b): what went wrong while
// brewing, for one method or all. Like prep tools they're archived, not
// hidden: archived ones leave the checklist, brews that had them keep them.
const ALL_METHODS = 'all';
const problemEntries = computed(() =>
  problems.value.map((p) => ({ id: p.id, name: p.name, hidden: !!p.archivedAt, builtin: null, choice: p.methodKind ?? ALL_METHODS })),
);
const problemMethodChoices = [{ value: ALL_METHODS, label: methodLabel(null) }, ...METHOD_ORDER.map((k) => ({ value: k, label: methodLabel(k) }))];
const asMethod = (choice: string): MethodKind | null => (choice === ALL_METHODS ? null : (choice as MethodKind));
const problemApi: ListApi = {
  create: (ws, name, choice) => brewProblemsApi.create(ws, { name, methodKind: asMethod(choice ?? ALL_METHODS) }),
  update: (ws, id, { name, hidden, choice }) =>
    brewProblemsApi.update(ws, id, {
      ...(name !== undefined ? { name } : {}),
      ...(hidden !== undefined ? { archived: hidden } : {}),
      ...(choice !== undefined ? { methodKind: asMethod(choice) } : {}),
    }),
  reorder: brewProblemsApi.reorder,
  usage: brewProblemsApi.usage,
  remove: brewProblemsApi.remove,
};
const archiveWords = { hide: 'Archive', show: 'Restore', hidden: 'Archived' };

// Recipe styles, one method at a time. A custom style brews like one of its
// method's built-ins (docs/api/recipe-styles.md §5e).
const method = ref<MethodKind>('filter');
const methodStyles = computed(() => styles.value.filter((s) => s.kind === method.value).map((s) => ({ ...s, choice: s.brewsLike })));
const brewsLikeChoices = computed(() => STYLES_BY_KIND[method.value].map((key) => ({ value: key, label: RECIPE_STYLES[key] })));
const styleApi = computed<ListApi>(() => {
  const kind = method.value;
  return {
    create: (ws, name, choice) => recipeStylesApi.create(ws, kind, name, (choice ?? STYLES_BY_KIND[kind][0]) as RecipeStyle),
    update: (ws, id, { choice, ...rest }) => recipeStylesApi.update(ws, id, { ...rest, ...(choice ? { brewsLike: choice as RecipeStyle } : {}) }),
    reorder: (ws, ids) => recipeStylesApi.reorder(ws, kind, ids),
    usage: recipeStylesApi.usage,
    remove: recipeStylesApi.remove,
  };
});
</script>

<template>
  <SettingsLayout title="Lists">
    <p class="muted">The choices offered in forms, for everyone in {{ workspaces.current?.name }}.</p>
    <section class="card stack" aria-labelledby="list-methods">
      <h2 id="list-methods">Brewer methods</h2>
      <p class="muted small">
        How brewers are grouped, and what "What are you making?" lists first when you brew. A method you add works like a built-in one (a Siphon
        works like filter), which decides its brewers' recipe fields, timer, recipe styles and drinks.
      </p>
      <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
      <EditableList
        v-else-if="!error"
        :entries="methodEntries"
        :api="methodApi"
        kind="method"
        noun="method"
        placeholder="e.g. Siphon"
        hidden-hint="Hidden methods aren't offered for new brewers; brewers already in one stay there."
        :choices="behaviourChoices"
        choice-label="Works like"
        :reload="load"
      />
    </section>

    <section class="card stack" aria-labelledby="list-processes">
      <h2 id="list-processes">Bean processes</h2>
      <p class="muted small">How the coffee was processed, offered in the bean form in this order.</p>
      <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
      <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
      <EditableList
        v-else
        :entries="processes"
        :api="processApi"
        kind="process"
        noun="process"
        placeholder="e.g. Yeast Inoculated"
        hidden-hint="Hidden processes aren't offered for new beans; beans that already have one keep it."
        :reload="load"
      />
    </section>

    <section class="card stack" aria-labelledby="list-styles">
      <h2 id="list-styles">Recipe styles</h2>
      <p class="muted small">
        How a recipe brews, offered in the recipe form for the brewer's method. A style you add brews like one of the built-ins (an "Inverted"
        AeroPress brews like immersion), which is how extraction is worked out and how the AI judges it.
      </p>
      <div class="methods" role="tablist" aria-label="Brewer method">
        <button
          v-for="k in METHOD_ORDER"
          :key="k"
          type="button"
          role="tab"
          :aria-selected="method === k"
          :class="{ on: method === k }"
          @click="method = k"
        >
          {{ METHOD_KINDS[k].label }}
        </button>
      </div>
      <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
      <EditableList
        v-else-if="!error"
        :key="method"
        :entries="methodStyles"
        :api="styleApi"
        kind="style"
        noun="style"
        :placeholder="method === 'espresso' ? 'e.g. Turbo shot' : 'e.g. Inverted'"
        hidden-hint="Hidden styles aren't offered for new recipes; recipes that already have one keep it."
        :choices="brewsLikeChoices"
        choice-label="Brews like"
        :reload="load"
      />
    </section>

    <section class="card stack" aria-labelledby="list-problems" :inert="problemBusy">
      <div class="card-head">
        <h2 id="list-problems">Brew problems</h2>
        <ListDataBar list="brew_problems" noun="brew problems" @imported="load()" />
      </div>
      <p class="muted small">
        What can go wrong while brewing, offered as a checklist when you log a brew (for its method, plus the ones for all methods). The AI reads
        them as the clearest clues for the next brew.
      </p>
      <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
      <EditableList
        v-else-if="!error"
        :entries="problemEntries"
        draggable
        v-model:busy="problemBusy"
        :api="problemApi"
        kind="problem"
        noun="problem"
        placeholder="e.g. Paper taste"
        hidden-hint="Archived problems leave the checklist; brews that had them keep them."
        :choices="problemMethodChoices"
        choice-label="For"
        :words="archiveWords"
        :reload="load"
      />
    </section>
    <FlavorLexiconCard />
    <p v-if="!workspaces.canEdit" class="muted small">Only owners and baristas can change lists.</p>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.methods {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  align-self: flex-start;
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.methods button {
  min-height: calc(var(--tap) - 6px);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: calc(var(--radius) - 2px);
  background: none;
  color: var(--brand);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.methods button.on {
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
</style>
