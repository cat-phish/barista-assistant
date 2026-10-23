<script setup lang="ts">
// The menu as guests see it (docs/api/public-menu.md §7): the builder's
// Preview, written to be reused by the guest page (backlog item 19).
import type { PublicBean, PublicMenu } from '../api/types';
import { BEAN_PROCESSES } from '../lib/beans';
import { ROAST_LEVELS } from '../lib/scale';

defineProps<{ menu: PublicMenu }>();

const price = (n: number, currency: string | null) => `${n.toFixed(2)}${currency ? ` ${currency}` : ''}`;
// "Washed · Light · Colombia, Huila" and "Peach, black tea".
function beanFacts(b: PublicBean): string {
  return [b.process ? BEAN_PROCESSES[b.process].label : null, b.roastLevel ? ROAST_LEVELS[b.roastLevel].label : null, [b.country, b.region].filter(Boolean).join(', ') || null, b.decaf ? 'Decaf' : null]
    .filter(Boolean)
    .join(' · ');
}
</script>

<template>
  <div class="menu-preview">
    <h2 class="bar">{{ menu.workspace.name }}</h2>
    <p v-if="menu.sections.length === 0" class="muted">Nothing on the menu yet: sections show once they have something in them.</p>
    <section v-for="s in menu.sections" :key="s.name" class="section">
      <h3>{{ s.name }}</h3>
      <p v-if="s.description" class="muted">{{ s.description }}</p>
      <ul class="items">
        <template v-for="(item, i) in s.items" :key="item.type === 'beans' ? `beans-${i}` : item.id">
          <li v-if="item.type === 'beans'" class="beans">
            <div v-for="b in item.beans" :key="b.id" class="bean">
              <strong>{{ b.roasterName }} {{ b.beanName }}</strong>
              <span v-if="beanFacts(b)" class="muted small">{{ beanFacts(b) }}</span>
              <span v-if="b.flavorProfile" class="small">{{ b.flavorProfile }}</span>
            </div>
            <p v-if="item.beans.length === 0" class="muted small">No beans to show right now.</p>
          </li>
          <li v-else class="item" :class="{ unavailable: !item.available }">
            <div class="line">
              <strong class="name">{{ item.name }}</strong>
              <span v-if="!item.available" class="badge">Unavailable</span>
              <span v-if="item.price !== null" class="price">{{ price(item.price, menu.currency) }}</span>
            </div>
            <span v-if="item.description" class="small">{{ item.description }}</span>
            <span class="muted small">
              {{ item.method }}<template v-if="item.variantOf"> · a twist on {{ item.variantOf }}</template><template v-if="item.ingredients.length"> · {{ item.ingredients.join(', ') }}</template>
            </span>
          </li>
        </template>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.menu-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
h2,
h3,
p {
  margin: 0;
}
.bar {
  font-size: 1.3rem;
  text-align: center;
}
h3 {
  font-size: 1.05rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-1);
  margin-bottom: var(--space-1);
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.item,
.bean {
  display: flex;
  flex-direction: column;
}
.beans {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.name {
  flex: 1;
}
.price {
  font-variant-numeric: tabular-nums;
}
.unavailable .name {
  text-decoration: line-through;
  color: var(--text-muted);
}
.small {
  font-size: 0.85rem;
}
</style>
