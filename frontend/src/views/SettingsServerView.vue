<script setup lang="ts">
// Settings → Server → Backups (docs/api/server.md §10): scheduled dumps of
// the whole database, for server admins (granted on the server).
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { errorMessage } from '../api/client';
import { serverApi, type BackupFrequency, type ServerBackups } from '../api/server';
import SettingsLayout from '../components/SettingsLayout.vue';
import { saveBlob } from '../lib/backup';
import { formatWhen } from '../lib/format';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const data = ref<ServerBackups | null>(null);
const loadError = ref('');
const form = reactive({ frequency: 'off' as BackupFrequency, hour: 3, weekday: 0, keep: 7 });
const saving = ref(false);
const saveError = ref('');
const saved = ref(false);
const running = ref(false);
const runNote = ref('');

async function load(): Promise<void> {
  try {
    data.value = await serverApi.backups();
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err);
  }
}
onMounted(async () => {
  await load();
  if (data.value) Object.assign(form, data.value.settings);
});

const changed = computed(() => {
  const s = data.value?.settings;
  return !!s && (s.frequency !== form.frequency || s.hour !== form.hour || s.weekday !== form.weekday || s.keep !== form.keep);
});
const keepValid = computed(() => Number.isInteger(form.keep) && form.keep >= 1 && form.keep <= 90);

async function save(): Promise<void> {
  if (!keepValid.value) return;
  saving.value = true;
  saveError.value = '';
  saved.value = false;
  try {
    data.value = await serverApi.saveBackupSettings({ ...form });
    saved.value = true;
  } catch (err) {
    saveError.value = errorMessage(err);
    await load(); // a 503 still saved the settings
  } finally {
    saving.value = false;
  }
}

// "Back up now" runs on the worker; check back a few times for the result.
let poll: ReturnType<typeof setInterval> | null = null;
onUnmounted(() => poll && clearInterval(poll));
async function backUpNow(): Promise<void> {
  running.value = true;
  runNote.value = '';
  const before = data.value?.status.lastRunAt ?? null;
  try {
    await serverApi.backUpNow();
    runNote.value = 'Backing up…';
    let tries = 0;
    poll = setInterval(async () => {
      tries++;
      await load();
      const after = data.value?.status.lastRunAt ?? null;
      if (after !== before || tries >= 30) {
        if (poll) clearInterval(poll);
        poll = null;
        running.value = false;
        runNote.value = after === before ? 'Still running; refresh in a while.' : '';
      }
    }, 2000);
  } catch (err) {
    runNote.value = errorMessage(err);
    running.value = false;
  }
}

// Downloading asks for the password again (the dump holds every account).
const downloading = ref<string | null>(null); // the file asking for the password
const password = ref('');
const fetching = ref(false);
const downloadError = ref('');
function askPassword(name: string): void {
  downloading.value = name;
  password.value = '';
  downloadError.value = '';
}
async function download(): Promise<void> {
  const name = downloading.value;
  if (!name || !password.value) return;
  fetching.value = true;
  downloadError.value = '';
  try {
    saveBlob(name, await serverApi.backupFile(name, password.value));
    downloading.value = null;
  } catch (err) {
    downloadError.value = errorMessage(err);
  } finally {
    password.value = '';
    fetching.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Backups">
    <p class="muted">
      Scheduled copies of the whole database: every workspace and account on this server. They're saved in the <code>backups</code> folder next
      to the app (you can copy them off this machine from there). Only server admins see this page.
    </p>
    <p v-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
    <template v-else-if="data">
      <section class="card stack" aria-labelledby="backup-schedule">
        <h2 id="backup-schedule">Schedule</h2>
        <form class="stack" novalidate @submit.prevent="save">
          <fieldset class="choices">
            <legend>Back up</legend>
            <label v-for="f in (['off', 'daily', 'weekly'] as const)" :key="f" class="checkbox">
              <input v-model="form.frequency" type="radio" name="frequency" :value="f" />
              {{ f === 'off' ? 'Off' : f === 'daily' ? 'Every day' : 'Once a week' }}
            </label>
          </fieldset>
          <div v-if="form.frequency !== 'off'" class="form-row">
            <div v-if="form.frequency === 'weekly'" class="field">
              <label for="backup-weekday">On</label>
              <select id="backup-weekday" v-model.number="form.weekday">
                <option v-for="(d, i) in WEEKDAYS" :key="d" :value="i">{{ d }}</option>
              </select>
            </div>
            <div class="field">
              <label for="backup-hour">At</label>
              <select id="backup-hour" v-model.number="form.hour">
                <option v-for="h in 24" :key="h" :value="h - 1">{{ hourLabel(h - 1) }}</option>
              </select>
              <span class="hint">{{ data.timezone }} time</span>
            </div>
          </div>
          <div class="field keep">
            <label for="backup-keep">Keep the newest</label>
            <input id="backup-keep" v-model.number="form.keep" type="number" min="1" max="90" inputmode="numeric" :aria-invalid="!keepValid" />
            <span v-if="!keepValid" class="field-error">1 to 90</span>
            <span v-else class="hint">Older ones are deleted after each backup.</span>
          </div>
          <p v-if="data.nextRunAt" class="muted small">Next backup: {{ formatWhen(data.nextRunAt) }}.</p>
          <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
          <p v-else-if="saved && !changed" class="muted small" aria-live="polite">Saved.</p>
          <button class="btn btn-primary" type="submit" :disabled="saving || !changed || !keepValid">{{ saving ? 'Saving…' : 'Save' }}</button>
        </form>
      </section>

      <section class="card stack" aria-labelledby="backup-status">
        <h2 id="backup-status">Backups</h2>
        <p v-if="data.status.lastError" class="form-error" role="alert">
          The last backup ({{ data.status.lastRunAt ? formatWhen(data.status.lastRunAt) : 'unknown' }}) failed: {{ data.status.lastError }}
        </p>
        <p v-else-if="data.status.lastRunAt" class="muted small">Last backup: {{ formatWhen(data.status.lastRunAt) }}<template v-if="data.status.lastBytes !== null">, {{ sizeLabel(data.status.lastBytes) }}</template>.</p>
        <div class="run">
          <button class="btn btn-secondary" type="button" :disabled="running" @click="backUpNow">{{ running ? 'Backing up…' : 'Back up now' }}</button>
          <span v-if="runNote" class="muted small" aria-live="polite">{{ runNote }}</span>
        </div>
        <ul v-if="data.files.length" class="files">
          <li v-for="f in data.files" :key="f.name">
            <div class="file">
              <span class="name">{{ formatWhen(f.createdAt) }}</span>
              <span class="muted small">{{ sizeLabel(f.bytes) }}</span>
              <button v-if="data.downloadsEnabled && downloading !== f.name" class="btn-link" type="button" @click="askPassword(f.name)">Download</button>
            </div>
            <form v-if="downloading === f.name" class="confirm" novalidate @submit.prevent="download">
              <label :for="`pw-${f.name}`">Your password, to download it</label>
              <div class="confirm-row">
                <input :id="`pw-${f.name}`" v-model="password" type="password" autocomplete="current-password" />
                <button class="btn btn-primary" type="submit" :disabled="fetching || !password">{{ fetching ? 'Downloading…' : 'Download' }}</button>
                <button class="btn-link" type="button" @click="downloading = null">Cancel</button>
              </div>
              <p v-if="downloadError" class="form-error" role="alert">{{ downloadError }}</p>
            </form>
          </li>
        </ul>
        <p v-else class="muted small">No backups yet.</p>
        <p v-if="!data.downloadsEnabled" class="muted small">Downloads are turned off on this server: copy backups from its <code>backups</code> folder.</p>
        <p class="muted small">A backup holds every account's data, including password hashes: keep downloads somewhere safe.</p>
      </section>

      <section class="card stack" aria-labelledby="backup-restore">
        <h2 id="backup-restore">Restoring one</h2>
        <p class="muted small">
          A backup replaces the whole database, so it's restored on the server, not in the app. Stop the app first, then from the app's folder
          (see docs/api/server.md):
        </p>
        <pre class="cmd">docker compose stop backend worker
gunzip -c backups/&lt;file&gt;.sql.gz | docker compose exec -T db sh -c \
  'mariadb -uroot -p"$(cat /run/secrets/db_root_password)" coffee_journal'
docker compose start backend worker</pre>
      </section>
    </template>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.choices {
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
}
.choices legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.keep input {
  max-width: 7rem;
}
.run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.files {
  list-style: none;
  margin: 0;
  padding: 0;
}
.files li {
  border-bottom: 1px solid var(--border);
}
.file {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-bottom: var(--space-2);
}
.confirm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.files .name {
  flex: 1;
}
.cmd {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  overflow-x: auto;
  border-radius: var(--radius);
  background: var(--brand-tint);
  font-size: 0.8rem;
}
</style>
