import { describe, expect, it } from 'vitest';
import { INSIGHT_TABS, type InsightChart } from '../api/types';
import { canAdd, explorePins, INSIGHT_TAB_INFO, layoutOrder, newUuid, onOverview, overviewCharts, tabOfRoute, toggleOverview, visibleTabs, withHidden, withOrder, withoutPin, withoutTab, withTilesBelow } from './insightCharts';

// The shared list, read as text: the frontend doesn't import @barista/shared.
const shared = Object.values(import.meta.glob('../../../shared/src/schema.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const parse = (name: string) => JSON.parse((new RegExp(`${name} = (\\[[^\\]]*\\])`).exec(shared)?.[1] ?? '[]')) as string[];

let n = 0;
const newId = () => `id${++n}`;
const explore = (tab: InsightChart['tab'], id = newId()): InsightChart => ({ id, kind: 'explore', tab, x: 'tds', y: 'rating' });

describe('added Insights charts (docs/api/stats.md §11b)', () => {
  it("have the API's tabs, each with a label", () => {
    expect([...INSIGHT_TABS]).toEqual(parse('INSIGHT_TABS'));
    expect(INSIGHT_TAB_INFO.map((t) => t.tab)).toEqual([...INSIGHT_TABS]);
  });
  it('leave out tabs the workspace hides', () => {
    expect(visibleTabs(new Set(['brew.grinder'])).map((t) => t.tab)).not.toContain('grinders');
    expect(visibleTabs(new Set()).map((t) => t.tab)).toContain('tools');
  });
  it('put a built-in chart on the Overview and take it off again', () => {
    const on = toggleOverview([explore('brews')], 'brews.rating', newId);
    expect(onOverview(on, 'brews.rating')).toMatchObject({ kind: 'chart', tab: 'overview', chart: 'brews.rating' });
    const off = toggleOverview(on, 'brews.rating', newId);
    expect(off).toHaveLength(1);
    expect(onOverview(off, 'brews.rating')).toBeUndefined();
  });
  it("group the Overview's built-in charts by their tab, and a tab's own Explore charts", () => {
    let list: InsightChart[] = [explore('brews', 'a'), explore('overview', 'b')];
    list = toggleOverview(toggleOverview(toggleOverview(list, 'brews.rating', newId), 'beans.spend', newId), 'brews.total', newId);
    expect(overviewCharts(list)).toEqual(new Map([['brews', new Set(['brews.rating', 'brews.total'])], ['beans', new Set(['beans.spend'])]]));
    expect(explorePins(list, 'brews').map((c) => c.id)).toEqual(['a']);
    expect(explorePins(list, 'overview').map((c) => c.id)).toEqual(['b']);
  });
  it('get UUIDs the API accepts', () => {
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('stop at the limit', () => {
    expect(canAdd(Array.from({ length: 49 }, () => explore('brews')))).toBe(true);
    expect(canAdd(Array.from({ length: 50 }, () => explore('brews')))).toBe(false);
  });
});

describe('chart layout (backlog: hide and reorder)', () => {
  const chart = (id: string, rank: number) => ({ id, title: id, rank });
  const present = [chart('brews.total', 0), chart('brews.count', 1), chart('brews.rating', 2), chart('pin:p', 3)];

  it('puts saved ids first and new charts at the end', () => {
    expect(layoutOrder(present)).toEqual(['brews.total', 'brews.count', 'brews.rating', 'pin:p']);
    expect(layoutOrder(present, ['brews.rating', 'gone.chart', 'brews.total'])).toEqual(['brews.rating', 'brews.total', 'brews.count', 'pin:p']);
  });
  it('keeps the order of charts not on the page, after the ones shown', () => {
    const layout = withOrder({ brews: { order: ['brews.tds', 'brews.total'] } }, 'brews', ['brews.count', 'brews.total']);
    expect(layout).toEqual({ brews: { order: ['brews.count', 'brews.total', 'brews.tds'] } });
  });
  it('hides and shows, and a reset tab is gone', () => {
    let layout = withHidden({}, 'brews', 'brews.problems', true);
    expect(layout).toEqual({ brews: { hidden: ['brews.problems'] } });
    layout = withHidden(layout, 'brews', 'brews.problems', false);
    expect(layout).toEqual({});
    expect(withoutTab({ brews: { order: ['brews.total'] }, beans: { hidden: ['beans.spend'] } }, 'brews')).toEqual({ beans: { hidden: ['beans.spend'] } });
  });
  it('drops a removed chart from every tab', () => {
    expect(withoutPin({ brews: { order: ['pin:p', 'brews.total'] }, overview: { order: ['pin:p'] } }, 'p')).toEqual({ brews: { order: ['brews.total'] } });
  });
  it('reorders tiles and charts on the Overview without disturbing the other group', () => {
    const start = { overview: { order: ['tile.brews', 'tile.rating', 'brews.total', 'pin:p'] } };
    const tiles = withOrder(start, 'overview', ['tile.rating', 'tile.brews']);
    expect(tiles.overview?.order).toEqual(['tile.rating', 'tile.brews', 'brews.total', 'pin:p']);
    const charts = withOrder(tiles, 'overview', ['pin:p', 'brews.total']);
    const present = ['tile.rating', 'tile.brews', 'brews.total', 'pin:p'].map((id, rank) => ({ id, title: id, rank }));
    const order = layoutOrder(present, charts.overview?.order);
    expect(order.filter((id) => id.startsWith('tile.'))).toEqual(['tile.rating', 'tile.brews']);
    expect(order.filter((id) => !id.startsWith('tile.'))).toEqual(['pin:p', 'brews.total']);
  });
  it('puts the tiles below the charts and back', () => {
    const below = withTilesBelow({}, true);
    expect(below).toEqual({ overview: { tilesBelow: true } });
    expect(withTilesBelow(below, false)).toEqual({});
  });
  it('knows the tab from the route', () => {
    expect(tabOfRoute('stats-brews')).toBe('brews');
    expect(tabOfRoute('stats-overview')).toBe('overview');
    expect(tabOfRoute('stats-explore')).toBeNull();
  });
});
