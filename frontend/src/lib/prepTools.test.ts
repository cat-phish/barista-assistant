import { describe, expect, it } from 'vitest';
import type { PrepTool } from '../api/types';
import { methodLabel, toolsFor } from './prepTools';

const tool = (id: string, methodKind: PrepTool['methodKind'], retired = false): PrepTool => ({
  id, name: id, methodKind, position: 0, retiredAt: retired ? '2026-10-22T00:00:00.000Z' : null, createdAt: '2026-10-22T00:00:00.000Z',
});
const tools = [tool('wdt', 'espresso'), tool('paper', 'filter'), tool('rdt', null), tool('old', 'espresso', true)];
const ids = (list: PrepTool[]) => list.map((t) => t.id);

describe('toolsFor', () => {
  it("shows the method's tools and the all-method ones, in order", () => {
    expect(ids(toolsFor(tools, 'espresso', []))).toEqual(['wdt', 'rdt']);
    expect(ids(toolsFor(tools, 'filter', []))).toEqual(['paper', 'rdt']);
    expect(ids(toolsFor(tools, 'stovetop', []))).toEqual(['rdt']);
  });

  it('shows every active tool without a recipe', () => {
    expect(ids(toolsFor(tools, null, []))).toEqual(['wdt', 'paper', 'rdt']);
  });

  it("keeps the brew's own tools, retired or for another method", () => {
    expect(ids(toolsFor(tools, 'filter', ['old', 'wdt']))).toEqual(['wdt', 'paper', 'rdt', 'old']);
  });
});

describe('methodLabel', () => {
  it('names the method, or all methods', () => {
    expect(methodLabel('espresso')).toBe('Espresso');
    expect(methodLabel(null)).toBe('All methods');
  });
});
