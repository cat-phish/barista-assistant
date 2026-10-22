<script setup lang="ts">
// The menu builder (docs/api/menu.md §7b), one tab of Bar setup: the public
// menu's sections and items, arranged by hand. Items are a drink, a brewer's
// plain brew, or the beans block; each can be renamed, described, priced and
// marked unavailable for the menu. Order is changed with ↑/↓ (like
// Categories); an item moves to another section from its Edit dialog.
import { computed, onMounted, ref } from 'vue';
import { brewersApi } from '../api/brewers';
import { errorMessage } from '../api/client';
import { drinksApi } from '../api/drinks';
import { menuApi } from '../api/menu';
import type { Brewer, Drink, Menu, MenuItem, MenuItemType, MenuSection } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { METHOD_KINDS } from '../lib/equipment';
import { parseDecimal } from '../lib/format';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const menu = ref<Menu>({ currency: null, sections: [] });
const drinks = ref<Drink[]>([]);
const brewers = ref<Brewer[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);

const isOwner = computed(() => workspaces.current?.role === 'owner');
const publicOn = computed(() => workspaces.current?.isPublicMenuEnabled ?? false);
const hasBeansBlock = computed(() => menu.value.sections.some((s) => s.items.some((i) => i.itemType === 'beans')));

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [m, d, b] = await Promise.all([menuApi.get(ws), drinksApi.list(ws), brewersApi.list(ws)]);
    menu.value = m;
    drinks.value = [...d.drinks].sort((x, y) => x.name.localeCompare(y.name));
    brewers.value = b.brewers.filter((x) => !x.retiredAt);
    currency.value = m.currency ?? '';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Every write returns the whole menu.
async function run(action: (ws: string) => Promise<Menu>, onError: (message: string) => void = (m) => (error.value = m)): Promise<boolean> {
  const ws = workspaces.current?.id;
  if (!ws) return false;
  busy.value = true;
  error.value = '';
  try {
    menu.value = await action(ws);
    return true;
  } catch (err) {
    onError(errorMessage(err));
    return false;
  } finally {
    busy.value = false;
  }
}

// --- Settings: public menu on/off (owners), currency ---
async function togglePublic(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  error.value = '';
  try {
    await workspacesApi.update(ws, { isPublicMenuEnabled: !publicOn.value });
    await workspaces.load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
const currency = ref('');
const currencyCode = computed(() => currency.value.trim().toUpperCase());
const currencyValid = computed(() => currencyCode.value === '' || /^[A-Z]{3}$/.test(currencyCode.value));
const currencyChanged = computed(() => currencyCode.value !== (menu.value.currency ?? ''));
const saveCurrency = () => run((ws) => menuApi.setCurrency(ws, currencyCode.value || null));

// --- Order (one layout for the whole menu) ---
const layoutOf = (sections: MenuSection[]) => sections.map((s) => ({ id: s.id, itemIds: s.items.map((i) => i.id) }));
function swap<T>(list: T[], i: number, j: number): T[] {
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  return copy;
}
function moveSection(index: number, by: -1 | 1): Promise<boolean> {
  return run((ws) => menuApi.layout(ws, layoutOf(swap(menu.value.sections, index, index + by))));
}
function moveItem(section: MenuSection, index: number, by: -1 | 1): Promise<boolean> {
  const sections = menu.value.sections.map((s) => (s.id === section.id ? { ...s, items: swap(s.items, index, index + by) } : s));
  return run((ws) => menuApi.layout(ws, layoutOf(sections)));
}

// --- Sections ---
const newSectionName = ref('');
async function addSection(): Promise<void> {
  const name = newSectionName.value.trim();
  if (name && (await run((ws) => menuApi.addSection(ws, name)))) newSectionName.value = '';
}
const sectionTarget = ref<MenuSection | null>(null);
const sectionName = ref('');
const sectionDescription = ref('');
const sectionError = ref('');
const confirmSectionDelete = ref(false);
function editSection(s: MenuSection): void {
  sectionTarget.value = s;
  sectionName.value = s.name;
  sectionDescription.value = s.description ?? '';
  sectionError.value = '';
  confirmSectionDelete.value = false;
}
async function saveSection(): Promise<void> {
  const s = sectionTarget.value;
  if (!s || !sectionName.value.trim()) return;
  const ok = await run(
    (ws) => menuApi.updateSection(ws, s.id, { name: sectionName.value.trim(), description: sectionDescription.value.trim() || null }),
    (m) => (sectionError.value = m),
  );
  if (ok) sectionTarget.value = null;
}
async function deleteSection(): Promise<void> {
  const s = sectionTarget.value;
  if (s && (await run((ws) => menuApi.removeSection(ws, s.id), (m) => (sectionError.value = m)))) sectionTarget.value = null;
}

// --- Items ---
function itemTitle(i: MenuItem): string {
  if (i.itemType === 'beans') return 'Beans';
  return i.name ?? i.source?.name ?? '(deleted)';
}
function itemSource(i: MenuItem): string {
  if (i.itemType === 'beans') return 'Your active beans that are shown on the menu';
  if (!i.source) return '';
  const what = i.itemType === 'drink' ? `${METHOD_KINDS[i.source.kind].label} drink` : `${METHOD_KINDS[i.source.kind].label} brewer, plain brew`;
  return i.name && i.name !== i.source.name ? `${i.source.name} · ${what}` : what;
}
const formatPrice = (price: number) => `${price.toFixed(2)}${menu.value.currency ? ` ${menu.value.currency}` : ''}`;
const setAvailable = (i: MenuItem, available: boolean) => run((ws) => menuApi.updateItem(ws, i.id, { available }));

// Add item dialog
const addTarget = ref<MenuSection | null>(null);
const addType = ref<MenuItemType>('drink');
const addSourceId = ref('');
const addError = ref('');
const addChoices = computed(() => {
  const section = addTarget.value;
  if (!section) return [];
  const used = new Set(section.items.map((i) => i.drinkId ?? i.brewerId));
  const list = addType.value === 'drink' ? drinks.value : addType.value === 'brewer' ? brewers.value : [];
  return list.filter((x) => !used.has(x.id)).map((x) => ({ id: x.id, label: `${x.name} (${METHOD_KINDS[x.kind].label})` }));
});
function openAdd(s: MenuSection): void {
  addTarget.value = s;
  addType.value = 'drink';
  addSourceId.value = '';
  addError.value = '';
}
async function confirmAdd(): Promise<void> {
  const s = addTarget.value;
  if (!s) return;
  const input =
    addType.value === 'beans'
      ? { itemType: 'beans' as const }
      : addType.value === 'drink'
        ? { itemType: 'drink' as const, drinkId: addSourceId.value }
        : { itemType: 'brewer' as const, brewerId: addSourceId.value };
  if (addType.value !== 'beans' && !addSourceId.value) return;
  if (await run((ws) => menuApi.addItem(ws, s.id, input), (m) => (addError.value = m))) addTarget.value = null;
}

// Edit item dialog: menu name and description, price, section, availability.
const itemTarget = ref<MenuItem | null>(null);
const itemName = ref('');
const itemDescription = ref('');
const itemPrice = ref('');
const itemSection = ref('');
const itemAvailable = ref(true);
const itemError = ref('');
const confirmItemDelete = ref(false);
const sectionOf = (item: MenuItem) => menu.value.sections.find((s) => s.items.some((i) => i.id === item.id)) ?? null;
const priceParsed = computed(() => (itemPrice.value.trim() ? parseDecimal(itemPrice.value, { scale: 2, min: 0, max: 1_000_000, exclusiveMax: true }) : null));
const itemProblem = computed(() => {
  if (priceParsed.value && !priceParsed.value.ok) return priceParsed.value.error;
  if (priceParsed.value && !menu.value.currency) return 'Set the menu currency above before adding prices.';
  const target = menu.value.sections.find((s) => s.id === itemSection.value);
  const item = itemTarget.value;
  if (item && target && target.id !== sectionOf(item)?.id) {
    const sourceId = item.drinkId ?? item.brewerId;
    if (sourceId && target.items.some((i) => (i.drinkId ?? i.brewerId) === sourceId)) return `It's already in ${target.name}.`;
  }
  return '';
});
function editItem(i: MenuItem): void {
  itemTarget.value = i;
  itemName.value = i.name ?? '';
  itemDescription.value = i.description ?? '';
  itemPrice.value = i.price === null ? '' : i.price.toFixed(2);
  itemSection.value = sectionOf(i)?.id ?? '';
  itemAvailable.value = i.available;
  itemError.value = '';
  confirmItemDelete.value = false;
}
async function saveItem(): Promise<void> {
  const i = itemTarget.value;
  if (!i || itemProblem.value) return;
  const onError = (m: string) => (itemError.value = m);
  const price = priceParsed.value?.ok ? priceParsed.value.value : null;
  const saved = await run(
    (ws) => menuApi.updateItem(ws, i.id, { name: itemName.value.trim() || null, description: itemDescription.value.trim() || null, price, available: itemAvailable.value }),
    onError,
  );
  if (!saved) return;
  // Moved: to the end of the chosen section.
  const from = sectionOf(i);
  if (from && itemSection.value && itemSection.value !== from.id) {
    const sections = menu.value.sections.map((s) => ({
      id: s.id,
      itemIds: s.id === from.id ? s.items.filter((x) => x.id !== i.id).map((x) => x.id) : s.id === itemSection.value ? [...s.items.map((x) => x.id), i.id] : s.items.map((x) => x.id),
    }));
    if (!(await run((ws) => menuApi.layout(ws, sections), onError))) return;
  }
  itemTarget.value = null;
}
async function deleteItem(): Promise<void> {
  const i = itemTarget.value;
  if (i && (await run((ws) => menuApi.removeItem(ws, i.id), (m) => (itemError.value = m)))) itemTarget.value = null;
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
    </div>
    <SetupTabs />
    <p class="muted intro">The public menu, arranged by hand: name your sections, then add drinks, plain brews and your beans in the order guests should see them.</p>
    <p v-if="loading" class="muted" aria-live="polite">Loading the menu…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="!loading">
      <section class="card stack" aria-labelledby="menu-settings">
        <h2 id="menu-settings">Public menu</h2>
        <div class="setting">
          <p>
            <strong>{{ publicOn ? 'On' : 'Off' }}</strong>
            <span class="muted"> · {{ publicOn ? `Published at /api/public/menu/${workspaces.current?.slug}. The guest page to show it isn't built yet (backlog item 18).` : 'Only your bar can see this menu.' }}</span>
          </p>
          <button v-if="isOwner" class="btn btn-secondary" type="button" :disabled="busy" @click="togglePublic">{{ publicOn ? 'Turn off' : 'Turn on' }}</button>
        </div>
        <p v-if="!isOwner" class="muted small">Only owners can turn the public menu on or off.</p>
        <form v-if="workspaces.canEdit" class="currency-row" @submit.prevent="saveCurrency">
          <div class="field">
            <label for="menu-currency">Currency for prices</label>
            <input id="menu-currency" v-model="currency" maxlength="3" class="currency" placeholder="USD" autocapitalize="characters" :aria-invalid="!currencyValid" />
          </div>
          <button class="btn btn-secondary" type="submit" :disabled="busy || !currencyValid || !currencyChanged">Save</button>
        </form>
        <p v-if="!currencyValid" class="field-error">Use a 3-letter code, e.g. USD.</p>
      </section>

      <p v-if="menu.sections.length === 0" class="card empty">No sections yet. Add one below, then put drinks and brews in it.</p>

      <section v-for="(s, si) in menu.sections" :key="s.id" class="card stack menu-section" :aria-label="s.name">
        <div class="section-head">
          <div>
            <h2>{{ s.name }}</h2>
            <p v-if="s.description" class="muted small">{{ s.description }}</p>
          </div>
          <div v-if="workspaces.canEdit" class="row-actions">
            <button class="btn-link" type="button" :disabled="busy || si === 0" :aria-label="`Move ${s.name} up`" @click="moveSection(si, -1)">↑</button>
            <button class="btn-link" type="button" :disabled="busy || si === menu.sections.length - 1" :aria-label="`Move ${s.name} down`" @click="moveSection(si, 1)">↓</button>
            <button class="btn-link" type="button" @click="editSection(s)">Edit</button>
          </div>
        </div>

        <p v-if="s.items.length === 0" class="muted small">Nothing in this section yet; it stays off the public menu until it has something.</p>
        <ul v-else class="items">
          <li v-for="(i, ii) in s.items" :key="i.id" :class="{ unavailable: !i.available }">
            <div class="item-main">
              <span class="item-name">{{ itemTitle(i) }}</span>
              <span class="muted small">{{ itemSource(i) }}</span>
              <span v-if="i.description" class="muted small">{{ i.description }}</span>
              <span v-if="i.source?.retired" class="field-error">This brewer is retired, so it's left off the public menu.</span>
            </div>
            <span v-if="i.price !== null" class="price">{{ formatPrice(i.price) }}</span>
            <label v-if="workspaces.canEdit && i.itemType !== 'beans'" class="checkbox small">
              <input type="checkbox" :checked="i.available" :disabled="busy" @change="setAvailable(i, !i.available)" />
              Available
            </label>
            <span v-else-if="!i.available" class="badge">Unavailable</span>
            <div v-if="workspaces.canEdit" class="row-actions">
              <button class="btn-link" type="button" :disabled="busy || ii === 0" :aria-label="`Move ${itemTitle(i)} up`" @click="moveItem(s, ii, -1)">↑</button>
              <button class="btn-link" type="button" :disabled="busy || ii === s.items.length - 1" :aria-label="`Move ${itemTitle(i)} down`" @click="moveItem(s, ii, 1)">↓</button>
              <button class="btn-link" type="button" @click="editItem(i)">Edit</button>
            </div>
          </li>
        </ul>
        <div v-if="workspaces.canEdit">
          <button class="btn-link" type="button" @click="openAdd(s)">+ Add to {{ s.name }}</button>
        </div>
      </section>

      <form v-if="workspaces.canEdit" class="card add-section" @submit.prevent="addSection">
        <div class="field">
          <label for="new-section">New section</label>
          <input id="new-section" v-model="newSectionName" maxlength="100" placeholder="e.g. Espresso drinks" />
        </div>
        <button class="btn btn-primary" type="submit" :disabled="busy || !newSectionName.trim()">Add section</button>
      </form>
    </template>
  </main>

  <ConfirmDialog :open="addTarget !== null" :title="`Add to ${addTarget?.name ?? ''}`" @cancel="addTarget = null">
    <form id="menu-add-form" class="stack" @submit.prevent="confirmAdd">
      <div class="field">
        <label for="add-type">What</label>
        <select id="add-type" v-model="addType" @change="addSourceId = ''">
          <option value="drink">A drink</option>
          <option value="brewer">A plain brew (a brewer)</option>
          <option value="beans" :disabled="hasBeansBlock">Your beans{{ hasBeansBlock ? ' (already on the menu)' : '' }}</option>
        </select>
      </div>
      <div v-if="addType !== 'beans'" class="field">
        <label for="add-source">{{ addType === 'drink' ? 'Drink' : 'Brewer' }}</label>
        <select id="add-source" v-model="addSourceId" required>
          <option value="" disabled>Choose…</option>
          <option v-for="c in addChoices" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
        <span v-if="addChoices.length === 0" class="hint">Everything is already in this section.</span>
      </div>
      <p v-else class="muted small">Lists your active beans that have "Show on the public menu" on. Archived beans drop off by themselves.</p>
      <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
    </form>
    <template #actions>
      <button class="btn btn-primary" type="submit" form="menu-add-form" :disabled="busy || (addType !== 'beans' && !addSourceId) || (addType === 'beans' && hasBeansBlock)">Add</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="addTarget = null">Cancel</button>
    </template>
  </ConfirmDialog>

  <ConfirmDialog :open="itemTarget !== null" :title="itemTarget ? `Edit ${itemTitle(itemTarget)}` : ''" @cancel="itemTarget = null">
    <form id="menu-item-form" class="stack" @submit.prevent="saveItem">
      <template v-if="itemTarget?.itemType !== 'beans'">
        <div class="field">
          <label for="item-name">Name on the menu <span class="muted">(optional)</span></label>
          <input id="item-name" v-model="itemName" maxlength="255" :placeholder="itemTarget?.source?.name ?? ''" />
          <span class="hint">Leave empty to use its own name.</span>
        </div>
        <div class="field">
          <label for="item-description">Description <span class="muted">(optional)</span></label>
          <input id="item-description" v-model="itemDescription" maxlength="500" :placeholder="itemTarget?.source?.description ?? 'e.g. Double shot, steamed oat milk'" />
        </div>
        <div class="field">
          <label for="item-price">Price <span class="muted">(optional{{ menu.currency ? `, ${menu.currency}` : '' }})</span></label>
          <input id="item-price" v-model="itemPrice" inputmode="decimal" placeholder="e.g. 5.50" />
        </div>
        <label class="checkbox">
          <input v-model="itemAvailable" type="checkbox" />
          Available (unavailable items stay on the menu, marked as such)
        </label>
      </template>
      <div class="field">
        <label for="item-section">Section</label>
        <select id="item-section" v-model="itemSection">
          <option v-for="s in menu.sections" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <p v-if="itemProblem" class="field-error">{{ itemProblem }}</p>
      <p v-if="confirmItemDelete" class="form-error" role="alert">Remove it from the menu? The {{ itemTarget?.itemType === 'beans' ? 'beans' : itemTarget?.itemType }} itself stays.</p>
      <p v-if="itemError" class="form-error" role="alert">{{ itemError }}</p>
    </form>
    <template #actions>
      <template v-if="confirmItemDelete">
        <button class="btn btn-danger" type="button" :disabled="busy" @click="deleteItem">Remove from menu</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="confirmItemDelete = false">Keep it</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" type="submit" form="menu-item-form" :disabled="busy || !!itemProblem">Save</button>
        <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmItemDelete = true">Remove</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="itemTarget = null">Cancel</button>
      </template>
    </template>
  </ConfirmDialog>

  <ConfirmDialog :open="sectionTarget !== null" title="Edit section" @cancel="sectionTarget = null">
    <form id="menu-section-form" class="stack" @submit.prevent="saveSection">
      <div class="field">
        <label for="section-name">Name</label>
        <input id="section-name" v-model="sectionName" maxlength="100" required />
      </div>
      <div class="field">
        <label for="section-description">Description <span class="muted">(optional)</span></label>
        <input id="section-description" v-model="sectionDescription" maxlength="500" placeholder="e.g. Made with our house espresso" />
      </div>
      <p v-if="confirmSectionDelete" class="form-error" role="alert">
        Delete {{ sectionTarget?.name }} and its {{ sectionTarget?.items.length }} item{{ sectionTarget?.items.length === 1 ? '' : 's' }} from the menu? The drinks and brewers themselves stay.
      </p>
      <p v-if="sectionError" class="form-error" role="alert">{{ sectionError }}</p>
    </form>
    <template #actions>
      <template v-if="confirmSectionDelete">
        <button class="btn btn-danger" type="button" :disabled="busy" @click="deleteSection">Delete section</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="confirmSectionDelete = false">Keep it</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" type="submit" form="menu-section-form" :disabled="busy || !sectionName.trim()">Save</button>
        <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmSectionDelete = true">Delete</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="sectionTarget = null">Cancel</button>
      </template>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
p {
  margin: 0;
}
h2 {
  font-size: 1.05rem;
}
.small {
  font-size: 0.85rem;
}
.setting,
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.section-head {
  align-items: flex-start;
}
.currency-row,
.add-section {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
}
.add-section .field {
  flex: 1;
}
.currency {
  max-width: 6rem;
  text-transform: uppercase;
}
.row-actions {
  display: flex;
  flex-shrink: 0;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.items li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border);
}
.items li:first-child {
  border-top: 0;
}
.items li.unavailable .item-name {
  text-decoration: line-through;
  color: var(--text-muted);
}
.item-main {
  display: flex;
  flex-direction: column;
  flex: 1 1 12rem;
  min-width: 0;
}
.item-name {
  font-weight: 600;
}
.price {
  font-variant-numeric: tabular-nums;
}
</style>
