import { describe, expect, it } from 'vitest';
import { canRemind, configFromForm, formatDelay, formValues, SERVICES } from './notifications';

const ntfy = SERVICES.find((s) => s.kind === 'ntfy')!;

describe('notification services', () => {
  it('lists each kind once', () => {
    expect(new Set(SERVICES.map((s) => s.kind)).size).toBe(SERVICES.length);
  });
  it('Rate later needs reminders on and an enabled channel', () => {
    expect(canRemind({ rateReminders: true }, [{ enabled: false }, { enabled: true }])).toBe(true);
    expect(canRemind({ rateReminders: true }, [{ enabled: false }])).toBe(false);
    expect(canRemind({ rateReminders: true }, [])).toBe(false);
    expect(canRemind({ rateReminders: false }, [{ enabled: true }])).toBe(false);
  });
  it('fills the form from what is saved, ntfy starting on ntfy.sh', () => {
    expect(formValues(ntfy, undefined)).toEqual({ server: 'https://ntfy.sh', topic: '', token: '' });
    const saved = { kind: 'ntfy' as const, enabled: true, createdAt: '', config: { server: 'https://n.example', topic: 't', token: '••••1234' } };
    expect(formValues(ntfy, saved)).toEqual({ server: 'https://n.example', topic: 't', token: '••••1234' });
  });
  it('sends trimmed values, blank optional ones as null', () => {
    expect(configFromForm(ntfy, { server: ' https://ntfy.sh ', topic: ' beans ', token: ' ' })).toEqual({ server: 'https://ntfy.sh', topic: 'beans', token: null });
  });
  it('formats the delay', () => {
    expect([formatDelay(15), formatDelay(60), formatDelay(90)]).toEqual(['15 min', '1 h', '1 h 30 min']);
  });
});
