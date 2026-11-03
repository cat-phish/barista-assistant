// Web Push on this device (docs/api/notifications.md §1b, "Web Push"): can it
// subscribe, what to call it, and the browser calls. The service worker side
// (showing the notification, opening its link) is public/push-sw.js.

// Why this device can't subscribe, or 'ok'.
export type PushSupport = 'ok' | 'insecure' | 'ios-home-screen' | 'unsupported';

export interface PushEnv {
  secure: boolean; // window.isSecureContext
  hasPush: boolean; // service worker, PushManager and Notification all there
  ios: boolean; // iPhone or iPad (including iPadOS asking for the desktop site)
  standalone: boolean; // opened from the Home Screen / as an installed app
}

export function pushSupport(env: PushEnv): PushSupport {
  if (!env.secure) return 'insecure';
  if (env.hasPush) return 'ok';
  // iOS 16.4+ only offers push to an app added to the Home Screen.
  if (env.ios && !env.standalone) return 'ios-home-screen';
  return 'unsupported';
}

export const SUPPORT_TEXT: Record<Exclude<PushSupport, 'ok'>, string> = {
  insecure: 'Notifications need the app opened over HTTPS.',
  'ios-home-screen': 'On iPhone and iPad, add the app to your Home Screen (Share → Add to Home Screen), open it from there, and turn notifications on here.',
  unsupported: "This browser can't receive notifications from the app.",
};

export function currentPushEnv(): PushEnv {
  const ua = navigator.userAgent;
  return {
    secure: window.isSecureContext,
    hasPush: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

// "Android · Chrome", from the user agent; the server keeps it as the device's name.
export function deviceLabel(ua: string, maxTouchPoints = 0): string {
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPod/.test(ua)
      ? 'iPhone'
      : /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
        ? 'iPad'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Macintosh/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  return [os, browser].filter(Boolean).join(' · ') || 'This device';
}

// The VAPID public key (base64url) as applicationServerKey wants it.
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// SHA-256 hex, to match a device's endpointHash.
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class PushBlockedError extends Error {}

// The service worker, or an error when it never starts (an untrusted HTTPS
// certificate stops it, as does a private window in some browsers).
async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("The app's service worker isn't running here, so it can't receive notifications. Is the site's HTTPS certificate trusted on this device?")), 5000)
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

// This device's current subscription, if any.
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport(currentPushEnv()) !== 'ok') return null;
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

// Whether a subscription was made with this server key: one from older keys
// (they were changed) no longer gets anything.
export function madeWithKey(sub: PushSubscription, publicKey: string): boolean {
  return sameKey(sub.options.applicationServerKey, keyBytes(publicKey));
}

// Asks for permission (call it from a tap) and subscribes this device.
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushBlockedError('Notifications are blocked for this app. Allow them in your browser or phone settings for this site, then try again.');
  const reg = await registration();
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // One made with another server key (the keys were changed) can't be reused.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
