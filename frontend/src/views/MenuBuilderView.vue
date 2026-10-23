<script setup lang="ts">
// The menu builder (docs/api/menu.md §7b), one tab of Bar setup: the public
// menu's sections and items, arranged by hand. Items are a drink, a brewer's
// plain brew, or the beans block; each can be renamed, described, priced and
// marked unavailable for the menu. Sections and items move by dragging their
// ⠿ handle (items between sections too) or with ↑/↓; the add picker adds
// several at once. Preview shows the menu as guests see it (§7).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { brewersApi } from '../api/brewers';
import { errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import { drinksApi } from '../api/drinks';
import { menuApi, type NewMenuItem } from '../api/menu';
import type { BeanMenuField, Brewer, Drink, DrinkCategory, Menu, MenuItem, MenuSection, PublicMenu } from '../api/types';
import { workspacesApi } from '../api/workspaces';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import MenuAddDialog from '../components/MenuAddDialog.vue';
import MenuPreview from '../components/MenuPreview.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { parseDecimal } from '../lib/format';
import { recallView, rememberView } from '../lib/listSort';
import { duplicateSection, showsAs } from '../lib/menuBuilder';
import { BEAN_MENU_FIELDS } from '../lib/publicMenu';
import QRCode from 'qrcode';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const menu = ref<Menu>({ currency: null, sections: [] });
const drinks = ref<Drink[]>([]);
const categories = ref<DrinkCategory[]>([]);
const preview = ref<PublicMenu | null>(null);
const brewers = ref<Brewer[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);

const isOwner = computed(() => workspaces.current?.role === 'owner');
const publicOn = computed(() => workspaces.current?.isPublicMenuEnabled ?? false);

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const [m, d, b, c] = await Promise.all([menuApi.get(ws), drinksApi.list(ws), brewersApi.list(ws), drinkCategoriesApi.list(ws)]);
    menu.value = m;
    categories.value = c.categories;
    drinks.value = [...d.drinks].sort((x, y) => x.name.localeCompare(y.name));
    brewers.value = b.brewers.filter((x) => !x.archivedAt);
    currency.value = m.currency ?? '';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  view.value = recallView(viewKey) === 'preview' ? 'preview' : recallView(viewKey) === 'both' ? 'both' : 'edit';
  await load();
});

// --- Edit / Preview (side by side on wide screens), remembered per workspace ---
type View = 'edit' | 'preview' | 'both';
const viewKey = `menu.view.${workspaces.current?.id ?? ''}`;
const view = ref<View>('edit');
watch(view, (v) => rememberView(viewKey, v));
const showPreview = computed(() => view.value !== 'edit');
async function loadPreview(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !showPreview.value) return;
  try {
    preview.value = await menuApi.preview(ws);
  } catch (err) {
    error.value = errorMessage(err);
  }
}
// Every change reloads the preview, while it's showing.
watch([menu, showPreview], () => void loadPreview());

// Side by side: both columns scroll with the page, tops level, until the
// shorter one's end comes into view; then it stays put (sticky) while the
// other keeps scrolling. Its sticky top is the window height minus its own
// height (or the gap, if it fits), so it stops with its bottom on screen.
const editorEl = ref<HTMLElement | null>(null);
const previewEl = ref<HTMLElement | null>(null);
const GAP = 16;
function setStickyTops(): void {
  for (const el of [editorEl.value, previewEl.value]) {
    if (el) el.style.setProperty('--stick-top', `${Math.min(GAP, window.innerHeight - el.offsetHeight - GAP)}px`);
  }
}
const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(setStickyTops);
watch([editorEl, previewEl], ([editor, pane], [oldEditor, oldPane]) => {
  for (const el of [oldEditor, oldPane]) if (el) resized?.unobserve(el);
  for (const el of [editor, pane]) if (el) resized?.observe(el);
  setStickyTops();
});
onMounted(() => window.addEventListener('resize', setStickyTops));
onBeforeUnmount(() => {
  window.removeEventListener('resize', setStickyTops);
  resized?.disconnect();
});

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
// The guest page's address, to copy, open or print as a QR code.
const pageUrl = computed(() => `${window.location.origin}/menu/${workspaces.current?.slug ?? ''}`);
const qr = ref('');
watch(
  [pageUrl, publicOn],
  async ([url, on]) => {
    qr.value = on ? await QRCode.toDataURL(url, { margin: 1, width: 480 }) : '';
  },
  { immediate: true },
);
const copied = ref(false);
async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pageUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    error.value = "Couldn't copy: select the address and copy it instead.";
  }
}

const currency = ref('');
const currencyCode = computed(() => currency.value.trim().toUpperCase());
const currencyValid = computed(() => currencyCode.value === '' || /^[A-Z]{3}$/.test(currencyCode.value));
const currencyChanged = computed(() => currencyCode.value !== (menu.value.currency ?? ''));
const saveCurrency = () => run((ws) => menuApi.setCurrency(ws, currencyCode.value || null));

// --- Order (one layout for the whole menu) ---
const layoutOf = (sections: MenuSection[]) => sections.map((s) => ({ id: s.id, itemIds: s.items.map((i) => i.id) }));
// What the drag handles move: a copy of the menu's sections and items, saved
// as one PUT /layout when a drag ends (and put back if it's refused).
const arranged = ref<MenuSection[]>([]);
watch(menu, (m) => (arranged.value = m.sections.map((s) => ({ ...s, items: [...s.items] }))), { immediate: true });
const announcement = ref('');
async function dropped(): Promise<void> {
  const twice = duplicateSection(arranged.value);
  if (twice) {
    error.value = `That's already in ${twice}.`;
    arranged.value = menu.value.sections.map((s) => ({ ...s, items: [...s.items] }));
    return;
  }
  if (JSON.stringify(layoutOf(arranged.value)) === JSON.stringify(layoutOf(menu.value.sections))) return;
  if (await run((ws) => menuApi.layout(ws, layoutOf(arranged.value)))) announcement.value = 'Menu order saved.';
  else arranged.value = menu.value.sections.map((s) => ({ ...s, items: [...s.items] }));
}
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
const formatPrice = (price: number) => `${price.toFixed(2)}${menu.value.currency ? ` ${menu.value.currency}` : ''}`;
const setAvailable = (i: MenuItem, available: boolean) => run((ws) => menuApi.updateItem(ws, i.id, { available }));

// Add picker (several at once, one request).
const addTarget = ref<MenuSection | null>(null);
const addError = ref('');
function openAdd(sec: MenuSection): void {
  addTarget.value = sec;
  addError.value = '';
}
async function confirmAdd(items: NewMenuItem[]): Promise<void> {
  const sec = addTarget.value;
  if (sec && items.length && (await run((ws) => menuApi.addItems(ws, sec.id, items), (m) => (addError.value = m)))) addTarget.value = null;
}

// Edit item dialog: menu name and description, price, section, availability.
const itemTarget = ref<MenuItem | null>(null);
const itemName = ref('');
const itemDescription = ref('');
const itemPrice = ref('');
const itemSection = ref('');
const itemAvailable = ref(true);
// The beans block: which details guests see per bean (null on the API = all).
const ALL_BEAN_FIELDS = Object.keys(BEAN_MENU_FIELDS) as BeanMenuField[];
const itemBeanFields = ref<BeanMenuField[]>([]);
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
  itemBeanFields.value = i.beanFields ?? [...ALL_BEAN_FIELDS];
  itemError.value = '';
  confirmItemDelete.value = false;
}
async function saveItem(): Promise<void> {
  const i = itemTarget.value;
  if (!i || itemProblem.value) return;
  const onError = (m: string) => (itemError.value = m);
  const price = priceParsed.value?.ok ? priceParsed.value.value : null;
  // In the checklist's order; every field ticked is stored as null (= all, including any added later).
  const beanFields = ALL_BEAN_FIELDS.filter((f) => itemBeanFields.value.includes(f));
  const input =
    i.itemType === 'beans'
      ? { beanFields: beanFields.length === ALL_BEAN_FIELDS.length ? null : beanFields }
      : { name: itemName.value.trim() || null, description: itemDescription.value.trim() || null, price, available: itemAvailable.value };
  const saved = await run((ws) => menuApi.updateItem(ws, i.id, input), onError);
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
            <span class="muted"> · {{ publicOn ? 'Guests can see it at the link below. Preview shows what they see.' : 'Only your bar can see this menu. Preview shows what guests would see.' }}</span>
          </p>
          <button v-if="isOwner" class="btn btn-secondary" type="button" :disabled="busy" @click="togglePublic">{{ publicOn ? 'Turn off' : 'Turn on' }}</button>
        </div>
        <div v-if="publicOn" class="share">
          <div class="share-link">
            <label for="menu-link">Guest page</label>
            <div class="link-row">
              <input id="menu-link" :value="pageUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
              <button class="btn btn-secondary" type="button" @click="copyLink">{{ copied ? 'Copied' : 'Copy' }}</button>
              <a class="btn btn-secondary" :href="pageUrl" target="_blank" rel="noopener">Open</a>
            </div>
            <span class="muted small">Print the QR code for the counter: it opens this page, and works offline once a guest has visited.</span>
          </div>
          <figure v-if="qr" class="qr">
            <img :src="qr" :alt="`QR code for ${pageUrl}`" width="160" height="160" />
            <a class="btn-link" :href="qr" :download="`${workspaces.current?.slug ?? 'menu'}-menu-qr.png`">Download QR (PNG)</a>
          </figure>
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

      <div class="view-toggle" role="group" aria-label="Show">
        <button v-for="v in (['edit', 'preview', 'both'] as const)" :key="v" type="button" class="btn" :class="view === v ? 'btn-primary' : 'btn-secondary'" :aria-pressed="view === v" @click="view = v">
          {{ v === 'edit' ? 'Edit' : v === 'preview' ? 'Preview' : 'Side by side' }}
        </button>
      </div>
      <span class="visually-hidden" aria-live="polite">{{ announcement }}</span>

      <div class="workspace" :class="view">
      <div v-if="view !== 'preview'" ref="editorEl" class="editor stack">
      <p v-if="menu.sections.length === 0" class="card empty">No sections yet. Add one below, then put drinks and brews in it.</p>

      <VueDraggable v-model="arranged" class="stack" handle=".section-handle" :animation="150" ghost-class="drag-ghost" :disabled="!workspaces.canEdit || busy" @end="dropped">
      <section v-for="(s, si) in arranged" :key="s.id" class="card stack menu-section" :aria-label="s.name">
        <div class="section-head">
          <button v-if="workspaces.canEdit" class="drag-handle section-handle" type="button" :aria-label="`Drag ${s.name} to move it. ↑ and ↓ also move it.`">⠿</button>
          <div class="section-title">
            <h2>{{ s.name }}</h2>
            <p v-if="s.description" class="muted small">{{ s.description }}</p>
          </div>
          <div v-if="workspaces.canEdit" class="row-actions">
            <button class="btn-link" type="button" :disabled="busy || si === 0" :aria-label="`Move ${s.name} up`" @click="moveSection(si, -1)">↑</button>
            <button class="btn-link" type="button" :disabled="busy || si === arranged.length - 1" :aria-label="`Move ${s.name} down`" @click="moveSection(si, 1)">↓</button>
            <button class="btn-link" type="button" @click="editSection(s)">Edit</button>
          </div>
        </div>

        <VueDraggable
          v-model="s.items"
          tag="ul"
          class="items"
          :class="{ empty: s.items.length === 0 }"
          group="menu-items"
          handle=".item-handle"
          :animation="150"
          ghost-class="drag-ghost"
          :disabled="!workspaces.canEdit || busy"
          @end="dropped"
        >
          <li v-for="(i, ii) in s.items" :key="i.id" :class="{ unavailable: !i.available }">
            <button v-if="workspaces.canEdit" class="drag-handle item-handle" type="button" :aria-label="`Drag ${itemTitle(i)} to move it, to another section too.`">⠿</button>
            <div class="item-main">
              <span class="item-name">{{ itemTitle(i) }}</span>
              <span class="muted small">{{ showsAs(i) }}</span>
              <span v-if="i.description" class="muted small">“{{ i.description }}”</span>
              <span v-if="i.source?.archived" class="field-error">This brewer is archived, so it's left off the public menu.</span>
            </div>
            <span v-if="i.price !== null" class="price" title="Shown next to its name">{{ formatPrice(i.price) }}</span>
            <label v-if="workspaces.canEdit && i.itemType !== 'beans'" class="checkbox small" title="Unavailable items stay on the menu, struck through">
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
        </VueDraggable>
        <p v-if="s.items.length === 0" class="muted small">Nothing here yet: add something, or drag an item in. Empty sections stay off the public menu.</p>
        <div v-if="workspaces.canEdit">
          <button class="btn-link" type="button" @click="openAdd(s)">+ Add to {{ s.name }}</button>
        </div>
      </section>
      </VueDraggable>

      <form v-if="workspaces.canEdit" class="card add-section" @submit.prevent="addSection">
        <div class="field">
          <label for="new-section">New section<span class="req" aria-hidden="true">*</span></label>
          <input id="new-section" aria-required="true" v-model="newSectionName" maxlength="100" placeholder="e.g. Espresso drinks" />
        </div>
        <button class="btn btn-primary" type="submit" :disabled="busy || !newSectionName.trim()">Add section</button>
      </form>
      </div>

      <aside v-if="showPreview" ref="previewEl" class="card preview" aria-label="Preview">
        <p v-if="!publicOn" class="muted small preview-note">This is what guests would see; the public menu is off.</p>
        <MenuPreview v-if="preview" :menu="preview" />
        <p v-else class="muted" aria-live="polite">Loading the preview…</p>
      </aside>
      </div>
    </template>
  </main>

  <MenuAddDialog
    :section="addTarget"
    :menu="menu"
    :drinks="drinks"
    :categories="categories"
    :brewers="brewers"
    :busy="busy"
    :error="addError"
    @cancel="addTarget = null"
    @add="confirmAdd"
  />

  <ConfirmDialog :open="itemTarget !== null" :title="itemTarget ? `Edit ${itemTitle(itemTarget)}` : ''" @cancel="itemTarget = null">
    <form id="menu-item-form" class="stack" @submit.prevent="saveItem">
      <template v-if="itemTarget?.itemType !== 'beans'">
        <div class="field">
          <label for="item-name">Name on the menu</label>
          <input id="item-name" v-model="itemName" maxlength="255" :placeholder="itemTarget?.source?.name ?? ''" />
          <span class="hint">Leave empty to use its own name.</span>
        </div>
        <div class="field">
          <label for="item-description">Description</label>
          <input id="item-description" v-model="itemDescription" maxlength="500" :placeholder="itemTarget?.source?.description ?? 'e.g. Double shot, steamed oat milk'" />
        </div>
        <div class="field">
          <label for="item-price">Price <span v-if="menu.currency" class="muted">({{ menu.currency }})</span></label>
          <input id="item-price" v-model="itemPrice" inputmode="decimal" placeholder="e.g. 5.50" />
        </div>
        <label class="checkbox">
          <input v-model="itemAvailable" type="checkbox" />
          Available (unavailable items stay on the menu, marked as such)
        </label>
      </template>
      <fieldset v-else class="bean-fields">
        <legend>Show for each bean</legend>
        <p class="muted small">The roaster and bean name always show. Beans only appear if "Show on the public menu" is on for them.</p>
        <label v-for="(label, key) in BEAN_MENU_FIELDS" :key="key" class="checkbox">
          <input v-model="itemBeanFields" type="checkbox" :value="key" />
          {{ label }}
        </label>
      </fieldset>
      <div class="field">
        <label for="item-section">Section<span class="req" aria-hidden="true">*</span></label>
        <select id="item-section" aria-required="true" v-model="itemSection">
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
        <label for="section-name">Name<span class="req" aria-hidden="true">*</span></label>
        <input id="section-name" aria-required="true" v-model="sectionName" maxlength="100" required />
      </div>
      <div class="field">
        <label for="section-description">Description</label>
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
.section-head {
  justify-content: flex-start;
}
.section-title {
  flex: 1;
  min-width: 0;
}
.items.empty {
  min-height: var(--tap); /* somewhere to drop into */
}
.share {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  flex-wrap: wrap;
}
.share-link {
  flex: 1 1 18rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.share-link label {
  font-weight: 600;
}
.link-row {
  display: flex;
  gap: var(--space-2);
}
.link-row input {
  flex: 1;
  min-width: 0;
}
.qr {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}
.qr img {
  background: #fff; /* scannable in dark mode too */
  border-radius: var(--radius-md, 6px);
}
.bean-fields {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.bean-fields legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.drag-handle {
  width: var(--tap);
  height: var(--tap);
  flex-shrink: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 1.3rem;
  line-height: 1;
  cursor: grab;
  /* Stop the browser scrolling instead of dragging on touch screens. */
  touch-action: none;
}
.drag-handle:active {
  cursor: grabbing;
}
.drag-ghost {
  opacity: 0.4;
}
.view-toggle {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.workspace.both {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--space-3);
  align-items: start;
}
/* Side by side: each column sticks once its end is on screen (--stick-top is
   set from its height in the script), so the shorter one stops there while
   the longer keeps scrolling. */
.workspace.both > .editor,
.workspace.both > .preview {
  position: sticky;
  top: var(--stick-top, var(--space-3));
}
.preview-note {
  margin-bottom: var(--space-3);
}
/* Side by side needs the room; narrower screens stack the preview below. */
@media (max-width: 1100px) {
  .workspace.both {
    display: flex;
    flex-direction: column;
  }
  .workspace.both > .editor,
  .workspace.both > .preview {
    position: static;
  }
}
</style>
