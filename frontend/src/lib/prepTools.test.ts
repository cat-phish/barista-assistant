import { describe, expect, it } from 'vitest';
import type { BrewProblem, PrepTool } from '../api/types';
import { offeredError, offeredLabel, problemsFor, recipePrep, toolsFor } from './prepTools';

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

describe('recipePrep', () => {
  it("ticks the recipe's prep that's active and offered for its brewer, in list order", () => {
    const recipe = (prepToolIds: string[], kind: 'espresso' | 'filter', id: string) => ({ prepToolIds, brewer: { id, kind } });
    expect(recipePrep(tools, recipe(['rdt', 'wdt'], 'espresso', 'gaggia'))).toEqual(['wdt', 'rdt']);
    expect(recipePrep(tools, recipe(['wdt', 'old', 'paper', 'gone'], 'espresso', 'gaggia'))).toEqual(['wdt']); // archived, not offered, deleted: left out
    expect(recipePrep(tools, recipe(['sandwich'], 'filter', 'oxo'))).toEqual(['sandwich']);
    expect(recipePrep(tools, recipe([], 'filter', 'v60'))).toEqual([]);
  });
});

describe('problemsFor', () => {
  const problem = (id: string, methodKinds: BrewProblem['methodKinds'], brewerIds: string[] = []) => ({ id, methodKinds, brewerIds, archivedAt: null });
  const problems = [problem('channeling', ['espresso']), problem('stalled', ['filter']), problem('paper', ['filter'], ['oxo']), problem('oxo-drip', [], ['oxo']), problem('tared', [])];
  it("offered like prep: the brew's method or brewer, plus every-brew ones; all without a recipe; keeps ticked ones", () => {
    expect(ids(problemsFor(problems, { kind: 'espresso', brewerId: 'gaggia' }, []))).toEqual(['channeling', 'tared']);
    expect(ids(problemsFor(problems, { kind: 'filter', brewerId: 'v60' }, []))).toEqual(['stalled', 'paper', 'tared']);
    expect(ids(problemsFor(problems, { kind: 'other', brewerId: 'oxo' }, []))).toEqual(['paper', 'oxo-drip', 'tared']);
    expect(ids(problemsFor(problems, { kind: null, brewerId: null }, []))).toEqual(['channeling', 'stalled', 'paper', 'oxo-drip', 'tared']);
    expect(ids(problemsFor(problems, { kind: 'filter', brewerId: 'v60' }, ['channeling']))).toEqual(['channeling', 'stalled', 'paper', 'tared']);
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

describe('offeredError', () => {
  it('asks for a method or brewer unless every brew', () => {
    expect(offeredError(true, [], [])).toBe('');
    expect(offeredError(false, ['filter'], [])).toBe('');
    expect(offeredError(false, [], ['oxo'])).toBe('');
    expect(offeredError(false, [], [])).toMatch(/Pick a method or brewer/);
  });
});
