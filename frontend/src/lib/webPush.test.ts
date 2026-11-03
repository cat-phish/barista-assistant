import { describe, expect, it } from 'vitest';
import { deviceLabel, keyBytes, pushSupport, sha256Hex } from './webPush';

// docs/api/notifications.md §1b, "Web Push"
const env = { secure: true, hasPush: true, ios: false, standalone: false };

describe('pushSupport', () => {
  it('ok with push in a secure page', () => {
    expect(pushSupport(env)).toBe('ok');
  });
  it('needs HTTPS', () => {
    expect(pushSupport({ ...env, secure: false })).toBe('insecure');
  });
  it('on iOS, points a Safari tab to the Home Screen; the installed app can subscribe', () => {
    expect(pushSupport({ ...env, hasPush: false, ios: true })).toBe('ios-home-screen');
    expect(pushSupport({ ...env, ios: true, standalone: true })).toBe('ok');
    expect(pushSupport({ ...env, hasPush: false, ios: true, standalone: true })).toBe('unsupported'); // before iOS 16.4
  });
  it('otherwise unsupported', () => {
    expect(pushSupport({ ...env, hasPush: false })).toBe('unsupported');
  });
});

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 0, 'Android · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 0, 'Android · Samsung Internet'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', 0, 'Android · Firefox'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 0, 'iPhone · Safari'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5, 'iPad · Safari'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 0, 'Mac · Safari'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 0, 'Windows · Edge'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 0, 'Linux · Firefox'],
    ['curl/8.0', 0, 'This device'],
  ])('%s', (ua, touch, label) => {
    expect(deviceLabel(ua, touch)).toBe(label);
  });
});

describe('helpers', () => {
  it('decodes a base64url key', () => {
    expect([...keyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });
  it('hashes like the server (SHA-256 hex)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
