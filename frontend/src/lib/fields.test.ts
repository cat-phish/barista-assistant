import { describe, expect, it } from 'vitest';
import { FIELDS, fieldsFor, hasValue, isShown } from './fields';

describe('field registry', () => {
  it('has unique keys, each prefixed by its form, in the shape the API accepts', () => {
    const keys = FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FIELDS) {
      expect(f.key.startsWith(`${f.form}.`), f.key).toBe(true);
      expect(f.key).toMatch(/^(brew|bean|recipe)\.[a-zA-Z]+$/);
    }
    expect(keys.length).toBeLessThanOrEqual(100); // the API's limit
  });
  it("doesn't list required fields, so they can't be hidden", () => {
    const keys: string[] = FIELDS.map((f) => f.key);
    for (const required of ['brew.dose', 'brew.water', 'brew.time', 'brew.bean', 'bean.roasterName', 'bean.beanName', 'recipe.name', 'recipe.brewer', 'recipe.dose']) {
      expect(keys).not.toContain(required);
    }
    // What the AI analysis works from stays too.
    expect(keys).not.toContain('brew.rating');
    expect(keys).not.toContain('brew.notes');
  });
  it('groups by form', () => {
    expect(fieldsFor('brew').every((f) => f.form === 'brew')).toBe(true);
    expect(fieldsFor('bean').length + fieldsFor('brew').length + fieldsFor('recipe').length).toBe(FIELDS.length);
  });
});

describe('showing a field', () => {
  const hidden = new Set(['brew.tds']);
  it('shows what is not hidden, hides what is', () => {
    expect(isShown('brew.temp', hidden, new Set())).toBe(true);
    expect(isShown('brew.tds', hidden, new Set())).toBe(false);
  });
  it('keeps a hidden field shown when the record had a value in it', () => {
    expect(isShown('brew.tds', hidden, new Set(['brew.tds']))).toBe(true);
  });
  it('counts blanks, empty lists, false and null as no value', () => {
    for (const v of [null, undefined, '', '  ', [], false]) expect(hasValue(v), String(v)).toBe(false);
    for (const v of ['1.38', 0, [1], true]) expect(hasValue(v), String(v)).toBe(true);
  });
});
