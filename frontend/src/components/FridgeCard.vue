<script setup lang="ts">
// "In the fridge" on the Brew page (docs/backlog.md item 14, on trial): the
// workspace's open cold brew batches, with what's left, Log a serving (on
// the batch's journal entry) and Batch finished. Hidden when there are none.
import { onMounted, ref } from 'vue';
import { brewLogsApi } from '../api/brews';
import { errorMessage } from '../api/client';
import { recipeStylesApi } from '../api/recipeStyles';
import { servingsApi } from '../api/servings';
import type { BrewLog } from '../api/types';
import { batchStock, stockText } from '../lib/batch';
import { batchSuffix } from '../lib/beans';
import { isLongStyle } from '../lib/coldBrew';
import { formatListDay, localDateInput } from '../lib/format';
import { usePreferences } from '../composables/usePreferences';
import { useWorkspaceStore } from '../stores/workspace';

const OPEN_BATCH_LOOKBACK = 20; // the newest brews per long style looked at

const workspaces = useWorkspaceStore();
const { recipeRoastLevel } = usePreferences();
const batches = ref<{ log: BrewLog; left: string }[]>([]);
const error = ref('');

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const { styles } = await recipeStylesApi.list(ws);
    const lists = await Promise.all(styles.filter((s) => isLongStyle(s.brewsLike)).map((s) => brewLogsApi.list(ws, { styleId: s.id, limit: OPEN_BATCH_LOOKBACK })));
    batches.value = lists
      .flatMap((l) => l.brewLogs)
      .flatMap((log) => {
        const stock = batchStock(log, recipeRoastLevel.value);
        return stock && !stock.finished ? [{ log, left: stockText(stock) }] : [];
      })
      .sort((a, b) => b.log.timestamp.localeCompare(a.log.timestamp));
  } catch {
    batches.value = []; // the card is a convenience: say nothing
  }
});

const busy = ref<string | null>(null);
async function finish(log: BrewLog): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = log.id;
  error.value = '';
  try {
    await servingsApi.finishBatch(ws, log.id, true);
    batches.value = batches.value.filter((b) => b.log.id !== log.id);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section v-if="batches.length" class="card stack fridge" aria-labelledby="fridge-heading">
    <h2 id="fridge-heading">In the fridge</h2>
    <ul>
      <li v-for="{ log, left } in batches" :key="log.id">
        <RouterLink class="what" :to="{ name: 'journal-entry', params: { id: log.id } }">
          <strong>{{ log.bean.roasterName }} {{ log.bean.beanName }}{{ batchSuffix(log.bean) }}</strong>
          <span class="muted small">{{ log.style?.name ?? 'Cold brew' }} · {{ formatListDay(localDateInput(new Date(log.timestamp))) }} · {{ left }}</span>
        </RouterLink>
        <div class="buttons">
          <RouterLink class="btn btn-secondary" :to="{ name: 'journal-entry', params: { id: log.id }, query: { serve: '1' } }">Log a serving</RouterLink>
          <button class="btn-link" type="button" :disabled="busy === log.id" @click="finish(log)">Finished</button>
        </div>
      </li>
    </ul>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.05rem;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.what {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.buttons {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
p {
  margin: 0;
}
</style>
