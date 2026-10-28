import { describe, expect, it } from 'vitest';
import type { BrewProblem, PrepTool } from '../api/types';
import { methodLabel, offeredLabel, problemsFor, toolsFor } from './prepTools';

const at = '2026-10-22T00:00:00.000Z';
const tool = (id: string, methodKinds: PrepTool['methodKinds'], brewerIds: string[] = [], archived = false): PrepTool => ({
  id, name: id, methodKinds, brewerIds, position: 0, archivedAt: archived ? at : null, createdAt: at,
});
const tools = [
  tool('wdt', ['espresso']),
  tool('paper', ['filter']),
  tool('sandwich', ['espresso'], ['oxo']),
  tool('kettle', ['filter', 'stovetop']),
  tool('rdt', []),
  tool('old', ['espresso'], [], true),
];
const ids = (list: Array<{ id: string }>) => list.map((t) => t.id);

describe('toolsFor', () => {
  it("shows the tools for the brew's method or brewer, and the every-brew ones, in order", () => {
    expect(ids(toolsFor(tools, { kind: 'espresso', brewerId: 'gaggia' }, []))).toEqual(['wdt', 'sandwich', 'rdt']);
    expect(ids(toolsFor(tools, { kind: 'filter', brewerId: 'v60' }, []))).toEqual(['paper', 'kettle', 'rdt']);
    expect(ids(toolsFor(tools, { kind: 'filter', brewerId: 'oxo' }, []))).toEqual(['paper', 'sandwich', 'kettle', 'rdt']);
    expect(ids(toolsFor(tools, { kind: 'stovetop', brewerId: null }, []))).toEqual(['kettle', 'rdt']);
    expect(ids(toolsFor(tools, { kind: 'other', brewerId: 'x' }, []))).toEqual(['rdt']);
  });

  it('a tool for brewers only is offered on just those', () => {
    const oxoOnly = [tool('oxo-filter', [], ['oxo'])];
    expect(ids(toolsFor(oxoOnly, { kind: 'filter', brewerId: 'oxo' }, []))).toEqual(['oxo-filter']);
    expect(ids(toolsFor(oxoOnly, { kind: 'filter', brewerId: 'v60' }, []))).toEqual([]);
  });

  it('shows every active tool without a recipe', () => {
    expect(ids(toolsFor(tools, { kind: null, brewerId: null }, []))).toEqual(['wdt', 'paper', 'sandwich', 'kettle', 'rdt']);
  });

  it("keeps the brew's own tools, archived or not offered for it", () => {
    expect(ids(toolsFor(tools, { kind: 'filter', brewerId: 'v60' }, ['old', 'wdt']))).toEqual(['wdt', 'paper', 'kettle', 'rdt', 'old']);
  });
});

describe('problemsFor', () => {
  const problem = (id: string, methodKind: BrewProblem['methodKind']) => ({ id, methodKind, archivedAt: null });
  const problems = [problem('channeling', 'espresso'), problem('stalled', 'filter'), problem('tared', null)];
  it("shows the method's problems and the all-method ones; all without a recipe; keeps ticked ones", () => {
    expect(ids(problemsFor(problems, 'espresso', []))).toEqual(['channeling', 'tared']);
    expect(ids(problemsFor(problems, null, []))).toEqual(['channeling', 'stalled', 'tared']);
    expect(ids(problemsFor(problems, 'filter', ['channeling']))).toEqual(['channeling', 'stalled', 'tared']);
  });
});

describe('offeredLabel', () => {
  const brewers = [{ id: 'oxo', name: 'Oxo Rapid Brewer' }, { id: 'v60', name: 'V60' }];
  it('methods in method order, then brewers; Every brew when neither', () => {
    expect(offeredLabel(tool('a', ['stovetop', 'espresso'], ['v60', 'oxo']), brewers)).toBe('Espresso, Stovetop, Oxo Rapid Brewer, V60');
    expect(offeredLabel(tool('a', [], ['oxo', 'gone']), brewers)).toBe('Oxo Rapid Brewer');
    expect(offeredLabel(tool('a', []), brewers)).toBe('Every brew');
  });
});

describe('methodLabel', () => {
  it('names the method, or all methods', () => {
    expect(methodLabel('espresso')).toBe('Espresso');
    expect(methodLabel(null)).toBe('All methods');
  });
});
