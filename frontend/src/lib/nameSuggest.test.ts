import { describe, expect, it } from 'vitest';
import { closeMatch, distinctNames, foldName, lastBag, normalizeName, rankNames } from './nameSuggest';

describe('normalizeName', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldName('  Café  Nöir, Co.')).toBe('cafe noir co');
  });
  it('drops trailing filler words but never the first word', () => {
    expect(normalizeName('Proud Mary Coffee Roasters')).toBe('proud mary');
    expect(normalizeName('Onyx Coffee Lab')).toBe('onyx');
    expect(normalizeName('Coffee')).toBe('coffee');
  });
});

describe('distinctNames', () => {
  it('keeps each name once in its most used spelling, sorted', () => {
    expect(distinctNames(['onyx', 'Onyx', 'Onyx', null, '', 'Black & White'])).toEqual(['Black & White', 'Onyx']);
  });
});

describe('rankNames', () => {
  const names = ['Black & White', 'Onyx Coffee Lab', 'Proud Mary', 'Sey', 'The Barn', 'Barn Owl'];
  it('orders starts with, word starts with, contains', () => {
    expect(rankNames('barn', names)).toEqual(['Barn Owl', 'The Barn']);
    expect(rankNames('b', names)).toEqual(['Black & White', 'Barn Owl', 'The Barn']);
    expect(rankNames('ar', names)).toEqual(['Proud Mary', 'The Barn', 'Barn Owl']); // all contain it: list order
  });
  it('finds a typo', () => {
    expect(rankNames('Prou Mar', names)).toEqual(['Proud Mary']);
    expect(rankNames('Pruod', names)).toEqual(['Proud Mary']);
  });
  it("doesn't offer what's typed exactly", () => {
    expect(rankNames('sey', names)).toEqual([]);
    expect(rankNames('  ', names)).toEqual([]);
  });
  it('puts preferred names first within a tier', () => {
    const coffees = ['Ethiopia Guji', 'Ethiopia Sidama', 'Ethiopia Yirgacheffe'];
    expect(rankNames('eth', coffees, { prefer: ['Ethiopia Sidama'] })).toEqual(['Ethiopia Sidama', 'Ethiopia Guji', 'Ethiopia Yirgacheffe']);
  });
  it('stops at the limit', () => {
    expect(rankNames('b', names, { limit: 2 })).toEqual(['Black & White', 'Barn Owl']);
  });
});

describe('closeMatch', () => {
  const roasters = ['Onyx Coffee Lab', 'Proud Mary Coffee Roasters', 'Sey'];
  it('finds the same roaster without its filler words', () => {
    expect(closeMatch('Proud Mary', roasters)).toBe('Proud Mary Coffee Roasters');
    expect(closeMatch('Onyx', roasters)).toBe('Onyx Coffee Lab');
  });
  it('finds a different case or a typo', () => {
    expect(closeMatch('sey', roasters)).toBe('Sey');
    expect(closeMatch('Onxy', roasters)).toBe('Onyx Coffee Lab');
  });
  it('finds it with more words after the name', () => {
    expect(closeMatch('Proud Mary Coffee Roasters', ['Proud Mary'])).toBe('Proud Mary');
    expect(closeMatch('Proud Mary Coffee Roasters Melbourne', roasters)).toBe('Proud Mary Coffee Roasters');
    expect(closeMatch('Proud Mary', ['Proud Mary Melbourne', 'Proud Mary Coffee'])).toBe('Proud Mary Coffee'); // the same name first
    expect(closeMatch('Sey Coffee Brooklyn', roasters)).toBeNull(); // "Sey": too short to stand alone
  });
  it('is null for an exact name or nothing close', () => {
    expect(closeMatch('Sey', roasters)).toBeNull();
    expect(closeMatch('Square Mile', roasters)).toBeNull();
    expect(closeMatch('', roasters)).toBeNull();
  });
});

describe('lastBag', () => {
  const bean = (id: string, roasterName: string, beanName: string, roastDate: string | null, createdAt = '2026-01-01T00:00:00Z') => ({
    id, roasterName, beanName, roastDate, createdAt,
  });
  const beans = [
    bean('a', 'Onyx Coffee Lab', 'Geometry', '2026-09-01T00:00:00Z'),
    bean('b', 'Onyx', 'geometry', '2026-10-01T00:00:00Z'),
    bean('c', 'Onyx', 'Monarch', '2026-10-20T00:00:00Z'),
  ];
  it('finds the latest bag of the same coffee', () => {
    expect(lastBag(beans, 'Onyx Coffee Lab', 'Geometry')?.id).toBe('b');
  });
  it('is null when the coffee is new or a name is empty', () => {
    expect(lastBag(beans, 'Onyx', 'Southern Weather')).toBeNull();
    expect(lastBag(beans, '', 'Geometry')).toBeNull();
  });
});
