<script setup lang="ts">
// Settings → Workspace: the name and web address (docs/api/workspaces.md §2),
// the public menu's switch, link, title and currency (docs/api/menu.md §7b),
// and deleting the workspace. Owners change the name, address and switch;
// baristas the menu's title and currency; viewers only see them.
import QRCode from 'qrcode';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import { menuApi } from '../api/menu';
import { workspacesApi } from '../api/workspaces';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SettingsLayout from '../components/SettingsLayout.vue';
import { SLUG_PATTERN } from '../lib/slug';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const router = useRouter();
const isOwner = computed(() => workspaces.current?.role === 'owner');
const publicOn = computed(() => workspaces.current?.isPublicMenuEnabled ?? false);

// --- Name and web address (owners) ---
const name = ref(workspaces.current?.name ?? '');
const slug = ref(workspaces.current?.slug ?? '');
const savingDetails = ref(false);
const detailsError = ref('');
const detailsSaved = ref(false);
const slugInvalid = computed(() => !SLUG_PATTERN.test(slug.value));
const slugChanged = computed(() => slug.value !== workspaces.current?.slug);
const detailsChanged = computed(() => name.value.trim() !== workspaces.current?.name || slugChanged.value);
const canSaveDetails = computed(() => detailsChanged.value && name.value.trim().length > 0 && !slugInvalid.value && !savingDetails.value);

async function saveDetails(): Promise<void> {
  const ws = workspaces.current;
  if (!ws || !canSaveDetails.value) return;
  savingDetails.value = true;
  detailsError.value = '';
  detailsSaved.value = false;
  try {
    await workspacesApi.update(ws.id, {
      ...(name.value.trim() !== ws.name ? { name: name.value.trim() } : {}),
      ...(slugChanged.value ? { slug: slug.value } : {}),
    });
    await workspaces.load();
    detailsSaved.value = true;
  } catch (err) {
    detailsError.value = err instanceof ApiError && err.status === 409 ? 'That web address is taken. Try another.' : errorMessage(err);
  } finally {
    savingDetails.value = false;
  }
}

// --- Public menu ---
const menuError = ref('');
const busy = ref(false);
const savedTitle = ref<string | null>(null);
const savedCurrency = ref<string | null>(null);
const title = ref('');
const currency = ref('');

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    const m = await menuApi.get(ws);
    savedTitle.value = m.title;
    savedCurrency.value = m.currency;
    title.value = m.title ?? '';
    currency.value = m.currency ?? '';
  } catch (err) {
    menuError.value = errorMessage(err);
  }
});

async function togglePublic(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  menuError.value = '';
  try {
    await workspacesApi.update(ws, { isPublicMenuEnabled: !publicOn.value });
    await workspaces.load();
  } catch (err) {
    menuError.value = errorMessage(err);
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
    menuError.value = "Couldn't copy: select the address and copy it instead.";
  }
}

async function saveMenu(patch: (ws: string) => Promise<{ title: string | null; currency: string | null }>): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  busy.value = true;
  menuError.value = '';
  try {
    const m = await patch(ws);
    savedTitle.value = m.title;
    savedCurrency.value = m.currency;
  } catch (err) {
    menuError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
// The menu's title; blank shows the workspace name.
const titleChanged = computed(() => title.value.trim() !== (savedTitle.value ?? ''));
const saveTitle = () => saveMenu((ws) => menuApi.setTitle(ws, title.value.trim() || null));
const currencyCode = computed(() => currency.value.trim().toUpperCase());
const currencyValid = computed(() => currencyCode.value === '' || /^[A-Z]{3}$/.test(currencyCode.value));
const currencyChanged = computed(() => currencyCode.value !== (savedCurrency.value ?? ''));
const saveCurrency = () => saveMenu((ws) => menuApi.setCurrency(ws, currencyCode.value || null));

// --- Delete (owners): type the web address to confirm (§2) ---
const deleting = ref(false);
const confirmText = ref('');
const deleteBusy = ref(false);
const deleteError = ref('');
function openDelete(): void {
  confirmText.value = '';
  deleteError.value = '';
  deleting.value = true;
}
async function deleteWorkspace(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  deleteBusy.value = true;
  deleteError.value = '';
  try {
    await workspacesApi.remove(ws, confirmText.value);
    deleting.value = false;
    workspaces.select(null);
    await workspaces.load();
    await router.push({ name: workspaces.current ? 'home' : 'workspaces' });
  } catch (err) {
    deleteError.value = errorMessage(err);
  } finally {
    deleteBusy.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Workspace">
    <section class="card stack" aria-labelledby="ws-details">
      <h2 id="ws-details">Name and web address</h2>
      <form v-if="isOwner" class="stack" novalidate @submit.prevent="saveDetails">
        <div class="field">
          <label for="ws-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="ws-name" v-model="name" aria-required="true" type="text" maxlength="255" required @input="detailsSaved = false" />
        </div>
        <div class="field">
          <label for="ws-slug">Web address<span class="req" aria-hidden="true">*</span></label>
          <input
            id="ws-slug"
            v-model.trim="slug"
            aria-required="true"
            type="text"
            inputmode="url"
            autocapitalize="none"
            spellcheck="false"
            maxlength="64"
            :aria-invalid="slugInvalid"
            aria-describedby="ws-slug-hint"
            @input="detailsSaved = false"
          />
          <span id="ws-slug-hint" class="hint" :class="{ invalid: slugInvalid }">
            3–64 lowercase letters, digits or hyphens. Your public menu is at /menu/{{ slug || '…' }}
          </span>
        </div>
        <p v-if="slugChanged && !slugInvalid" class="warning" role="note">
          The old address, /menu/{{ workspaces.current?.slug }}, will stop working, and so will QR codes you've printed for it.
        </p>
        <p v-if="detailsError" class="form-error" role="alert">{{ detailsError }}</p>
        <div class="actions">
          <button class="btn btn-primary" type="submit" :disabled="!canSaveDetails">{{ savingDetails ? 'Saving…' : 'Save' }}</button>
          <span v-if="detailsSaved" class="muted small" aria-live="polite">Saved.</span>
        </div>
      </form>
      <dl v-else class="readonly">
        <dt>Name</dt>
        <dd>{{ workspaces.current?.name }}</dd>
        <dt>Web address</dt>
        <dd>/menu/{{ workspaces.current?.slug }}</dd>
      </dl>
      <p v-if="!isOwner" class="muted small">Only owners can change these.</p>
    </section>

    <section class="card stack" aria-labelledby="menu-settings">
      <h2 id="menu-settings">Public menu</h2>
      <div class="setting">
        <p>
          <strong>{{ publicOn ? 'On' : 'Off' }}</strong>
          <span class="muted"> · {{ publicOn ? 'Guests can see it at the link below.' : 'Only your bar can see the menu.' }}</span>
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
      <form v-if="workspaces.canEdit" class="title-row" @submit.prevent="saveTitle">
        <div class="field">
          <label for="menu-title">Menu title</label>
          <input id="menu-title" v-model="title" maxlength="255" :placeholder="workspaces.current?.name ?? ''" />
          <span class="hint">The heading guests see. Leave empty to use your bar's name.</span>
        </div>
        <button class="btn btn-secondary" type="submit" :disabled="busy || !titleChanged">Save</button>
      </form>
      <form v-if="workspaces.canEdit" class="currency-row" @submit.prevent="saveCurrency">
        <div class="field">
          <label for="menu-currency">Currency for prices</label>
          <input id="menu-currency" v-model="currency" maxlength="3" class="currency" placeholder="USD" autocapitalize="characters" :aria-invalid="!currencyValid" />
        </div>
        <button class="btn btn-secondary" type="submit" :disabled="busy || !currencyValid || !currencyChanged">Save</button>
      </form>
      <p v-if="!currencyValid" class="field-error">Use a 3-letter code, e.g. USD.</p>
      <p v-if="menuError" class="form-error" role="alert">{{ menuError }}</p>
      <p class="muted small">Arrange what's on it in <RouterLink :to="{ name: 'menu-builder' }">Bar setup → Menu</RouterLink>.</p>
    </section>

    <section v-if="isOwner" class="card danger-zone">
      <div>
        <h2>Delete this workspace</h2>
        <p class="muted small">Everything in it goes for good: members, beans, equipment, recipes, the journal and the menu.</p>
      </div>
      <button class="btn btn-danger" type="button" @click="openDelete">Delete</button>
    </section>
  </SettingsLayout>

  <ConfirmDialog :open="deleting" :title="`Delete ${workspaces.current?.name ?? 'workspace'}?`" @cancel="deleting = false">
    <form id="delete-ws" class="stack" @submit.prevent="deleteWorkspace">
      <p>This can't be undone. Every bean, recipe, brew and member of this workspace is deleted.</p>
      <div class="field">
        <label for="confirm-slug">Type <strong>{{ workspaces.current?.slug }}</strong> to confirm</label>
        <input id="confirm-slug" v-model="confirmText" autocapitalize="none" autocomplete="off" spellcheck="false" />
      </div>
      <p v-if="deleteError" class="form-error" role="alert">{{ deleteError }}</p>
    </form>
    <template #actions>
      <button class="btn btn-danger" type="submit" form="delete-ws" :disabled="deleteBusy || confirmText !== workspaces.current?.slug">
        {{ deleteBusy ? 'Deleting…' : 'Delete workspace' }}
      </button>
      <button class="btn btn-secondary" type="button" @click="deleting = false">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.hint.invalid {
  color: var(--danger);
}
.warning {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--danger-tint);
  color: var(--danger);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.readonly {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
}
.readonly dt {
  font-weight: 600;
}
.readonly dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.setting {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.title-row,
.currency-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.title-row .field {
  flex: 1;
}
.currency-row .field {
  flex: 0 0 auto;
}
.title-row .btn,
.currency-row .btn {
  margin-top: 1.6rem; /* line up with the input, below its label */
}
.currency {
  max-width: 6rem;
  text-transform: uppercase;
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
  flex-wrap: wrap;
  gap: var(--space-2);
}
.link-row input {
  flex: 1 1 12rem;
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
.danger-zone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.danger-zone > div {
  flex: 1 1 16rem;
}
</style>
