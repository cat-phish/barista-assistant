<script setup lang="ts">
// Settings → Notifications (docs/api/notifications.md §1b): your own reminder
// channels (Web Push to this app's devices, ntfy, Gotify, Pushover, Discord,
// Telegram, Slack, a webhook) and rate-later reminders. Each service saves on its own; the switch and the
// delay save as soon as they change.
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiError, errorMessage } from '../api/client';
import { notificationsApi } from '../api/notifications';
import type { NotificationChannel, NotificationKind, PushDevice, UserPreferences } from '../api/types';
import SettingsLayout from '../components/SettingsLayout.vue';
import { usePreferences } from '../composables/usePreferences';
import { configFromForm, formatDelay, formValues, SERVICES, type Service } from '../lib/notifications';
import { currentPushEnv, currentSubscription, deviceLabel, madeWithKey, pushSupport, sha256Hex, subscribeThisDevice, SUPPORT_TEXT } from '../lib/webPush';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

const auth = useAuthStore();
const { prefs } = usePreferences();
const channels = ref<NotificationChannel[]>([]);
const loading = ref(true);
const loadError = ref('');
const saved = (kind: NotificationKind) => channels.value.find((c) => c.kind === kind);
const pushDevices = ref<PushDevice[]>([]);
const anyEnabled = computed(() => channels.value.some((c) => c.enabled) || pushDevices.value.some((d) => d.enabled)); // reminders can be delivered

// Per service: open or not, the form, its Enabled box, and what happened.
const open = ref<NotificationKind | null>(null);
const forms = reactive<Record<string, Record<string, string>>>({});
const enabled = reactive<Record<string, boolean>>({});
const busy = ref<NotificationKind | null>(null);
const status = reactive<Record<string, { ok: boolean; text: string } | undefined>>({});

function reset(service: Service): void {
  const c = saved(service.kind);
  forms[service.kind] = formValues(service, c);
  enabled[service.kind] = c?.enabled ?? true;
}

onMounted(async () => {
  try {
    ({ channels: channels.value, pushDevices: pushDevices.value } = await notificationsApi.list());
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
  for (const s of SERVICES) reset(s);
  void loadPush();
});

// Web Push ("Web Push" in §1b): this device's own notifications. One entry
// per device; this one is recognised by its subscription's endpoint hash.
const support = pushSupport(currentPushEnv());
const serverKey = ref<string | null | undefined>(undefined); // null = not set up on the server
const thisHash = ref<string | null>(null);
const staleHash = ref<string | null>(null); // this device's subscription from older server keys
const pushBusy = ref<string | null>(null); // 'section' (subscribing) or a device id
const pushStatus = reactive<Record<string, { ok: boolean; text: string } | undefined>>({});

async function loadPush(): Promise<void> {
  try {
    serverKey.value = (await notificationsApi.pushKey()).publicKey;
  } catch (err) {
    serverKey.value = err instanceof ApiError && err.status === 404 ? null : undefined;
  }
  const sub = await currentSubscription();
  if (!sub) return;
  const hash = await sha256Hex(sub.endpoint);
  // Made with older server keys: no longer reached, so offer to subscribe
  // again, and drop its old entry once that's done.
  if (serverKey.value && !madeWithKey(sub, serverKey.value)) staleHash.value = hash;
  else thisHash.value = hash;
}
const thisDevice = computed(() => pushDevices.value.find((d) => d.endpointHash === thisHash.value));

async function pushRun(key: string, action: () => Promise<string>): Promise<void> {
  pushBusy.value = key;
  pushStatus[key] = undefined;
  pushStatus.section = undefined;
  try {
    pushStatus[key] = { ok: true, text: await action() };
  } catch (err) {
    pushStatus[key] = { ok: false, text: errorMessage(err) };
  } finally {
    pushBusy.value = null;
  }
}
function subscribe(): Promise<void> {
  return pushRun('section', async () => {
    if (!serverKey.value) throw new Error("Web Push isn't set up on this server.");
    const sub = await subscribeThisDevice(serverKey.value);
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys.auth) throw new Error("The browser didn't return a usable subscription.");
    const { device } = await notificationsApi.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, label: deviceLabel(navigator.userAgent, navigator.maxTouchPoints) });
    pushDevices.value = [...pushDevices.value.filter((d) => d.id !== device.id), device];
    thisHash.value = device.endpointHash;
    const stale = pushDevices.value.find((d) => d.endpointHash === staleHash.value && d.id !== device.id);
    staleHash.value = null;
    if (stale) {
      await notificationsApi.removeDevice(stale.id).catch(() => undefined); // it's dead either way
      pushDevices.value = pushDevices.value.filter((d) => d.id !== stale.id);
    }
    return 'This device gets notifications now. Send a test to check.';
  });
}
function setDeviceEnabled(device: PushDevice, on: boolean): Promise<void> {
  return pushRun(device.id, async () => {
    const { device: saved } = await notificationsApi.setDeviceEnabled(device.id, on);
    pushDevices.value = pushDevices.value.map((d) => (d.id === saved.id ? saved : d));
    return on ? 'On.' : 'Off: no reminders here.';
  });
}
function testDevice(device: PushDevice): Promise<void> {
  return pushRun(device.id, async () => {
    try {
      await notificationsApi.testDevice(device.id);
    } catch (err) {
      // Gone: the device left the list, so say so under the section.
      if (err instanceof ApiError && err.status === 410) {
        pushDevices.value = pushDevices.value.filter((d) => d.id !== device.id);
        pushStatus.section = { ok: false, text: `${device.label}: ${errorMessage(err)}` };
      }
      throw err;
    }
    return 'Sent: check that it arrived.';
  });
}
function removeDevice(device: PushDevice): Promise<void> {
  return pushRun(device.id, async () => {
    await notificationsApi.removeDevice(device.id);
    pushDevices.value = pushDevices.value.filter((d) => d.id !== device.id);
    if (device.endpointHash === thisHash.value) {
      await (await currentSubscription())?.unsubscribe();
      thisHash.value = null;
    }
    pushStatus.section = { ok: true, text: `${device.label} removed.` };
    return '';
  });
}

function toggle(service: Service): void {
  open.value = open.value === service.kind ? null : service.kind;
  status[service.kind] = undefined;
  reset(service);
}

async function run(kind: NotificationKind, action: () => Promise<string>): Promise<void> {
  busy.value = kind;
  status[kind] = undefined;
  try {
    status[kind] = { ok: true, text: await action() };
  } catch (err) {
    status[kind] = { ok: false, text: errorMessage(err) };
  } finally {
    busy.value = null;
  }
}

function save(service: Service): Promise<void> {
  return run(service.kind, async () => {
    const { channel } = await notificationsApi.save(service.kind, { enabled: enabled[service.kind] ?? true, config: configFromForm(service, forms[service.kind] ?? {}) });
    channels.value = [...channels.value.filter((c) => c.kind !== service.kind), channel];
    reset(service);
    return 'Saved.';
  });
}
function test(service: Service): Promise<void> {
  return run(service.kind, async () => {
    await notificationsApi.test(service.kind);
    return 'Sent: check that it arrived.';
  });
}
function remove(service: Service): Promise<void> {
  return run(service.kind, async () => {
    await notificationsApi.remove(service.kind);
    channels.value = channels.value.filter((c) => c.kind !== service.kind);
    reset(service);
    return 'Removed.';
  });
}

// Rate reminders: on by default, but only usable with a service to send through.
const DELAYS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const delays = computed(() => [...new Set([...DELAYS, prefs.value.rateReminderMinutes])].sort((a, b) => a - b));
const prefSaving = ref(false);
const prefError = ref('');
// Home roasting's reminders show while the current workspace roasts.
const roasting = computed(() => !!useWorkspaceStore().current?.settings.homeRoasting);
async function setPref(changes: Partial<Pick<UserPreferences, 'rateReminders' | 'rateReminderMinutes' | 'rateLaterDefault' | 'steepReminders' | 'restReminders' | 'greenStockAlerts'>>): Promise<void> {
  prefSaving.value = true;
  prefError.value = '';
  try {
    await auth.setPreferences(changes);
  } catch (err) {
    prefError.value = errorMessage(err);
  } finally {
    prefSaving.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Notifications">
    <p class="muted">Where your reminders go. These are yours only; other members set up their own.</p>

    <section class="card stack" aria-labelledby="rate-reminders">
      <h2 id="rate-reminders">Rate later</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.rateReminders" :disabled="prefSaving" @change="setPref({ rateReminders: ($event.target as HTMLInputElement).checked })" />
        Offer "Rate later" when saving a brew, and remind me to rate it
      </label>
      <div class="field delay">
        <label for="reminder-delay">Remind me after</label>
        <select id="reminder-delay" :value="prefs.rateReminderMinutes" :disabled="prefSaving" @change="setPref({ rateReminderMinutes: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="m in delays" :key="m" :value="m">{{ formatDelay(m) }}</option>
        </select>
      </div>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.rateLaterDefault" :disabled="prefSaving" @change="setPref({ rateLaterDefault: ($event.target as HTMLInputElement).checked })" />
        Start with "Rate later" ticked
      </label>
      <p v-if="!prefs.rateReminders" class="muted small">Off: the brew page doesn't show Rate later.</p>
      <p v-else-if="!anyEnabled" class="muted small">Nothing is set up and on yet, so the brew page shows Rate later greyed out. Turn on this app's notifications or set up a service below.</p>
      <p v-if="prefError" class="form-error" role="alert">{{ prefError }}</p>
    </section>

    <section class="card stack" aria-labelledby="steep-reminders">
      <h2 id="steep-reminders">Cold brew</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.steepReminders" :disabled="prefSaving" @change="setPref({ steepReminders: ($event.target as HTMLInputElement).checked })" />
        Remind me when a cold brew is ready to filter
      </label>
      <p class="muted small">Sent when its recipe's steep time opens (e.g. after 12 h of a 12–18 h steep), unless you've finished it already.</p>
    </section>

    <section v-if="roasting" class="card stack" aria-labelledby="roast-reminders">
      <h2 id="roast-reminders">Home roasting</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.restReminders" :disabled="prefSaving" @change="setPref({ restReminders: ($event.target as HTMLInputElement).checked })" />
        Remind me when a roast I logged has rested
      </label>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.greenStockAlerts" :disabled="prefSaving" @change="setPref({ greenStockAlerts: ($event.target as HTMLInputElement).checked })" />
        Tell me when a roast takes a green coffee below its low-stock amount
      </label>
      <p class="muted small">The rest reminder comes at 8:00 on the day it's ready (its roast date plus its rest days).</p>
    </section>

    <p v-if="loading" class="muted" aria-live="polite">Loading…</p>
    <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
    <section v-if="!loading && !loadError" class="card stack" aria-labelledby="web-push">
      <h2 id="web-push">This app</h2>
      <p class="muted small">Notifications from the app itself on your phone or computer, with no other app needed. Each device is turned on from that device.</p>
      <p v-if="serverKey === null" class="muted small">Web Push isn't set up on this server: whoever runs it adds VAPID keys to turn it on.</p>
      <p v-else-if="support !== 'ok'" class="muted small">{{ SUPPORT_TEXT[support] }}</p>
      <div v-else-if="serverKey && !thisDevice" class="actions">
        <button class="btn btn-primary" type="button" :disabled="pushBusy === 'section'" @click="subscribe">Get notifications on this device</button>
      </div>
      <p v-if="pushStatus.section" :class="pushStatus.section.ok ? 'muted small' : 'form-error'" :role="pushStatus.section.ok ? 'status' : 'alert'">
        {{ pushStatus.section.text }}
      </p>
      <ul v-if="pushDevices.length" class="devices">
        <li v-for="d in pushDevices" :key="d.id" class="device stack">
          <div class="device-head">
            <span>{{ d.label }}<span v-if="d.id === thisDevice?.id" class="muted"> · this device</span></span>
            <label class="checkbox">
              <input type="checkbox" :checked="d.enabled" :disabled="pushBusy === d.id" @change="setDeviceEnabled(d, ($event.target as HTMLInputElement).checked)" />
              On
            </label>
          </div>
          <div class="actions">
            <button class="btn btn-secondary" type="button" :disabled="pushBusy === d.id || serverKey === null" @click="testDevice(d)">Send test</button>
            <button class="btn-link danger" type="button" :disabled="pushBusy === d.id" @click="removeDevice(d)">Remove</button>
          </div>
          <p v-if="pushStatus[d.id]" :class="pushStatus[d.id]!.ok ? 'muted small' : 'form-error'" :role="pushStatus[d.id]!.ok ? 'status' : 'alert'">
            {{ pushStatus[d.id]!.text }}
          </p>
        </li>
      </ul>
    </section>
    <section v-for="s in SERVICES" v-else :key="s.kind" class="card service" :aria-labelledby="`svc-${s.kind}`">
      <button class="service-head" type="button" :aria-expanded="open === s.kind" @click="toggle(s)">
        <h2 :id="`svc-${s.kind}`">{{ s.name }}</h2>
        <span class="badge" :class="{ on: saved(s.kind)?.enabled }">{{ !saved(s.kind) ? 'Not set up' : saved(s.kind)!.enabled ? 'On' : 'Off' }}</span>
      </button>
      <form v-if="open === s.kind && forms[s.kind]" class="stack" novalidate @submit.prevent="save(s)">
        <p class="muted small">{{ s.hint }}</p>
        <div v-for="f in s.fields" :key="f.key" class="field">
          <label :for="`svc-${s.kind}-${f.key}`">{{ f.label }}<span v-if="!f.optional" class="req" aria-hidden="true">*</span></label>
          <input
            :id="`svc-${s.kind}-${f.key}`"
            v-model="forms[s.kind]![f.key]"
            :type="f.secret ? 'password' : 'text'"
            :aria-required="!f.optional"
            autocomplete="off"
            spellcheck="false"
            :placeholder="f.placeholder"
          />
        </div>
        <label class="checkbox">
          <input v-model="enabled[s.kind]" type="checkbox" />
          Send reminders here
        </label>
        <div class="actions">
          <button class="btn btn-primary" type="submit" :disabled="busy === s.kind">Save</button>
          <button v-if="saved(s.kind)" class="btn btn-secondary" type="button" :disabled="busy === s.kind" @click="test(s)">Send test</button>
          <button v-if="saved(s.kind)" class="btn-link danger" type="button" :disabled="busy === s.kind" @click="remove(s)">Remove</button>
        </div>
        <p v-if="status[s.kind]" :class="status[s.kind]!.ok ? 'muted small' : 'form-error'" :role="status[s.kind]!.ok ? 'status' : 'alert'">
          {{ status[s.kind]!.text }}
        </p>
      </form>
    </section>
  </SettingsLayout>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
  margin: 0;
}
p {
  margin: 0;
}
.delay select {
  max-width: 12rem;
}
.service {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.service-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-height: var(--tap);
}
.badge {
  font-size: 0.8rem;
  padding: 2px var(--space-2);
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  white-space: nowrap;
}
.badge.on {
  border-color: var(--brand);
  color: var(--brand);
}
.devices {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.device + .device {
  border-top: 1px solid var(--border);
  padding-top: var(--space-3);
}
.device-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
</style>
