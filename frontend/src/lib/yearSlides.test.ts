import { describe, expect, it } from 'vitest';
import type { RecapFigures } from './recap';
import type { YearFigures } from './yearInCoffee';
import type { YearFigures as Fig } from './yearInCoffee';
import { hourLabel, personLabels, slideDuration, SLIDE_MS, summaryLines, yearSlides, type SlideContext } from './yearSlides';

const recap = (over: Partial<RecapFigures> = {}): RecapFigures => ({
  brews: 0, previousBrews: 0, daysBrewed: 0, rating: null, previousRating: null, best: [], caffeineMg: null, volume: null, forOthers: null,
  coffeeGrams: 0, beansBrewed: [], beansAdded: [], beansFinished: [], newRecipes: [], topRecipe: null, topBrewer: null, ...over,
});
const figures = (over: Partial<YearFigures> = {}): YearFigures => ({
  year: 2026, recap: recap(), months: Array(12).fill(0), streak: null, busiestMonth: null, busiestWeekday: null, favouriteHour: null,
  origins: [], originNames: [], roasters: [], roasterNames: [], processes: [], varieties: [], flavors: [], mostImproved: null, people: [], topCups: null, ...over,
});
const ctx: SlideContext = { mine: true, inProgress: false, volume: (ml) => `${ml} ml`, weight: (g) => `${g} g`, person: (id) => (id === 'u' ? 'You' : `${id}@example.com`) };

describe('Your Year in Coffee slides (backlog 65)', () => {
  it('a year without brews says so, and nothing else', () => {
    const slides = yearSlides(figures(), { ...ctx, inProgress: true });
    expect(slides.map((s) => s.key)).toEqual(['intro', 'empty']);
    expect(slides[0]).toMatchObject({ kicker: 'Your year in coffee', value: '2026', sub: 'So far' });
  });

  it('skips the figures left out, and ends on the summary', () => {
    const f = figures({ recap: recap({ brews: 3, daysBrewed: 2, coffeeGrams: 60 }) });
    expect(yearSlides(f, ctx).map((s) => s.key)).toEqual(['intro', 'brews', 'coffee', 'summary']);
  });

  it('shows every figure a full year has, in order', () => {
    const f = figures({
      recap: recap({
        brews: 120, previousBrews: 80, daysBrewed: 90, rating: { mean: 4.1, n: 100 }, caffeineMg: 15000, volume: { ml: 30000, estimated: true },
        forOthers: { brews: 10, ml: 2000, estimated: false, guests: [{ name: 'Sam', brews: 8 }] }, coffeeGrams: 2400,
        beansBrewed: [{ id: 'k', label: 'House Kenya', brews: 50 }], beansAdded: [{ id: 'k', label: 'House Kenya' }], beansFinished: [{ id: 'k', label: 'House Kenya' }],
        newRecipes: [{ id: 'r', name: 'V60 Daily' }], topRecipe: { name: 'V60 Daily', brews: 70 }, topBrewer: { name: 'V60', brews: 90 },
        best: [{ brewId: 'b1', rating: 5, day: '2026-06-01', bean: 'House Kenya', recipe: 'V60 Daily', brewer: 'V60' }],
      }),
      streak: { days: 12, start: '2026-03-01', end: '2026-03-12' },
      busiestMonth: { month: 2, brews: 20 },
      busiestWeekday: { weekday: 5, brews: 30 },
      favouriteHour: { hour: 7, brews: 40 },
      origins: [{ name: 'Kenya', brews: 50 }, { name: 'Ethiopia', brews: 30 }],
      roasters: [{ name: 'House', brews: 50 }, { name: 'Atlas', brews: 20 }],
      processes: [{ name: 'Washed', brews: 60 }, { name: 'Natural', brews: 30 }],
      varieties: [{ name: 'SL28', brews: 50 }, { name: 'Heirloom', brews: 30 }],
      flavors: [{ name: 'Sweet', brews: 40 }, { name: 'Lemon', brews: 20 }],
      mostImproved: { kind: 'recipe', name: 'V60 Daily', from: 3.25, to: 4.5, brews: 20 },
      topCups: { rating: 5, brews: 1, bean: null, recipe: null, by: null },
    });
    const slides = yearSlides(f, ctx);
    expect(slides.map((s) => s.key)).toEqual(['intro', 'brews', 'streak', 'month', 'when', 'coffee', 'volume', 'others', 'beans', 'origins', 'roasters', 'processes', 'varieties', 'flavors', 'recipe', 'best', 'improved', 'new', 'summary']);
    const by = (k: string) => slides.find((s) => s.key === k)!;
    expect(by('brews')).toMatchObject({ value: '120 brews', sub: 'on 90 days' });
    expect(by('streak')).toMatchObject({ value: '12 days in a row', sub: '1 Mar – 12 Mar' });
    expect(by('when').value).toBe('Saturdays, 7 am');
    expect(by('volume')).toMatchObject({ value: '≈ 30000 ml', sub: 'and ≈ 15.0 g of caffeine' });
    expect(by('best')).toMatchObject({ value: '5 ★ House Kenya', sub: '1 Jun · V60 Daily', link: { name: 'journal-entry', params: { id: 'b1' } } });
    expect(by('improved').sub).toBe('3.3 → 4.5 ★ over 20 rated brews');
    expect(by('new')).toMatchObject({ value: '1 new bean, 1 new recipe', sub: 'and 1 bag finished' });
    expect(summaryLines(f, ctx).map((l) => l.name)).toEqual(['Days brewed', 'Coffee used', 'You drank', 'Longest streak', 'Top bean', 'Top origin', 'Top recipe', 'Best cup']);
  });

  it('counts several top-rated cups, with the bean, recipe and person behind most', () => {
    const f = figures({
      recap: recap({ brews: 40, daysBrewed: 30, coffeeGrams: 800, best: [{ brewId: 'b', rating: 5, day: '2026-02-02', bean: 'Kenya', recipe: null, brewer: null }] }),
      people: [{ userId: 'v', brews: 25 }, { userId: 'u', brews: 15 }],
      topCups: { rating: 5, brews: 14, bean: { name: 'House Kenya', brews: 9 }, recipe: { name: 'V60 Daily', brews: 6 }, by: 'v' },
    });
    const best = yearSlides(f, { ...ctx, mine: false }).find((s) => s.key === 'best')!;
    expect(best).toMatchObject({ kicker: 'Best cups', value: '14 cups at 5 ★', sub: '9 with House Kenya · 6 on V60 Daily · mostly by v@example.com' });
    expect(best.link).toBeUndefined();
    expect(summaryLines(f, ctx).find((l) => l.name === 'Best cups')).toMatchObject({ detail: '14 at 5 ★' });
    const bare = yearSlides(figures({ ...f, topCups: { rating: 4.5, brews: 3, bean: null, recipe: null, by: null } }), ctx).find((s) => s.key === 'best')!;
    expect(bare).toMatchObject({ value: '3 cups at 4.5 ★', sub: undefined });
  });

  it("the bar's year names who brewed, and whose was the best cup", () => {
    const f = figures({
      recap: recap({ brews: 5, daysBrewed: 5, coffeeGrams: 100, best: [{ brewId: 'b', rating: 4.5, day: '2026-02-02', bean: 'Kenya', recipe: null, brewer: null }] }),
      people: [{ userId: 'v', brews: 3 }, { userId: 'u', brews: 2 }],
      topCups: { rating: 4.5, brews: 1, bean: null, recipe: null, by: 'v' },
    });
    const slides = yearSlides(f, { ...ctx, mine: false });
    expect(slides[0]!.kicker).toBe("The bar's year in coffee");
    expect(slides.find((s) => s.key === 'best')!.sub).toBe('2 Feb · by v@example.com');
    expect(slides.find((s) => s.key === 'people')).toMatchObject({ value: 'v@example.com', list: [{ name: 'v@example.com', detail: '3 brews' }, { name: 'You', detail: '2 brews' }] });
  });

  it('names you "You", others by name, and the unnamed by a numbered stand-in', () => {
    const name = personLabels([{ userId: 'v' }, { userId: 'u' }, { userId: 'w' }, { userId: 'x' }], 'u', (id) => (id === 'w' ? 'Sam' : null));
    expect(['u', 'v', 'w', 'x'].map(name)).toEqual(['You', 'Member 1', 'Sam', 'Member 2']);
  });

  it('labels hours on a 12-hour clock', () => {
    expect([0, 7, 12, 17].map(hourLabel)).toEqual(['12 am', '7 am', '12 pm', '5 pm']);
  });

  it('gives each slide time to be read before moving on', () => {
    expect(slideDuration({ key: 'intro', kicker: '', value: '2026', sub: 'So far' })).toBe(SLIDE_MS.intro);
    const plain = slideDuration({ key: 'brews', kicker: '', value: '7 brews' });
    const withSub = slideDuration({ key: 'brews', kicker: '', value: '7 brews', sub: 'on 5 days' });
    const withList = slideDuration({ key: 'origins', kicker: '', value: 'Kenya', list: [{ name: 'a', detail: '' }, { name: 'b', detail: '' }] });
    expect(plain).toBe(SLIDE_MS.base);
    expect(withSub).toBeGreaterThan(plain);
    expect(withList).toBe(SLIDE_MS.base + 2 * SLIDE_MS.row);
    const long = slideDuration({ key: 'people', kicker: '', value: 'x', sub: 'y', list: Array(20).fill({ name: 'a', detail: '' }) });
    expect(long).toBe(SLIDE_MS.max);
  });

  it('compares with earlier years: last year, the average year, a record', () => {
    const year = (y: number, brews: number, over: Partial<Fig> = {}) => figures({ year: y, recap: recap({ brews, daysBrewed: brews, coffeeGrams: brews * 15 }), ...over });
    const now = year(2026, 105, { origins: [{ name: 'Kenya', brews: 50 }, { name: 'Peru', brews: 5 }], originNames: ['Kenya', 'Peru', 'Laos'] });
    // A first year: nothing to compare with.
    expect(yearSlides(now, ctx).find((s) => s.key === 'brews')!.compare).toBeUndefined();
    // One earlier year: last year only, no average.
    const one = yearSlides(now, { ...ctx, history: [year(2025, 100, { originNames: ['Kenya'] })] });
    expect(one.find((s) => s.key === 'brews')!.compare).toEqual([{ dir: 'up', text: '+5% on 2025' }]);
    expect(one.find((s) => s.key === 'origins')!.compare).toEqual([{ dir: 'up', text: '+2 on 2025' }, { dir: 'up', text: '2 new to you' }]);
    // Two earlier years, beaten both: a record instead of the average.
    const two = yearSlides(now, { ...ctx, history: [year(2025, 100), year(2024, 60)] });
    expect(two.find((s) => s.key === 'brews')!.compare).toEqual([{ dir: 'up', text: '+5% on 2025' }, { dir: 'up', text: 'Your biggest year yet', record: true }]);
    // Not a record: the average year (100 and 120 → 110; 105 is −5%).
    const avg = yearSlides(now, { ...ctx, history: [year(2025, 100), year(2024, 120)] });
    expect(avg.find((s) => s.key === 'brews')!.compare![1]).toEqual({ dir: 'down', text: '−5% on an average year' });
    // In progress: the same dates.
    const soFar = yearSlides(now, { ...ctx, inProgress: true, history: [year(2025, 100)] });
    expect(soFar.find((s) => s.key === 'brews')!.compare).toEqual([{ dir: 'up', text: '+5% on 2025 by this date' }]);
    // The summary: last year, short.
    expect(summaryLines(now, { ...ctx, history: [year(2025, 50)] })[0]).toMatchObject({ name: 'Days brewed', change: { dir: 'up', text: '2.1×' } });
    expect(slideDuration(one.find((s) => s.key === 'brews')!)).toBe(SLIDE_MS.base + SLIDE_MS.sub + SLIDE_MS.compare);
  });

  it('a partial last year: totals at its pace, streak and origins left out, rating as it is', () => {
    const now = figures({
      year: 2025,
      recap: recap({ brews: 112, daysBrewed: 100, coffeeGrams: 1680, rating: { mean: 4.2, n: 50 } }),
      streak: { days: 10, start: '2025-03-01', end: '2025-03-10' },
      origins: [{ name: 'Kenya', brews: 60 }, { name: 'Peru', brews: 52 }],
      originNames: ['Kenya', 'Peru'],
    });
    const partial = figures({
      year: 2024,
      recap: recap({ brews: 28, daysBrewed: 25, coffeeGrams: 420, rating: { mean: 4.0, n: 20 } }),
      streak: { days: 5, start: '2024-10-02', end: '2024-10-06' },
      originNames: ['Kenya'],
    });
    const history = [{ ...partial, covered: { from: '2024-10-01', days: 92, scale: 4, tooShort: false } }];
    const slides = yearSlides(now, { ...ctx, history });
    const by = (k: string) => slides.find((s) => s.key === k)!;
    expect(by('brews').compare).toEqual([{ dir: 'same', text: "About the same as 2024's pace", note: '(2024 started on 1 Oct, scaled to a full year)' }]);
    expect(by('coffee').compare!.map((c) => c.text)).toEqual(["About the same as 2024's pace", '+0.2 ★ on 2024']);
    expect(by('streak').compare).toBeUndefined();
    expect(by('origins').compare).toEqual([{ dir: 'up', text: '1 new to you' }]);
    expect(summaryLines(now, { ...ctx, history })[0]!.change).toMatchObject({ dir: 'same', text: '=' });
    // Too short: no comparison at all.
    const short = yearSlides(now, { ...ctx, history: [{ ...partial, covered: { from: '2024-12-10', days: 22, scale: 16.6, tooShort: true } }] });
    expect(short.find((s) => s.key === 'coffee')!.compare).toBeUndefined();
  });
});
