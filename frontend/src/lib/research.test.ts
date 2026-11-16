import { describe, expect, it } from 'vitest';
import type { BuiltInFinding, ResearchSettings } from '../api/types';
import { effectiveMode, EVIDENCE_LABELS, findingProblem, LEVER_LABELS, MODE_LABELS, OWN_EVIDENCE, RESEARCH_LEVERS, RESEARCH_MODES, RESEARCH_SCOPES, SCOPE_LABELS } from './research';

// The shared lists, read as text: the frontend doesn't import @barista/shared.
const research = Object.values(import.meta.glob('../../../shared/src/research.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const settings = Object.values(import.meta.glob('../../../shared/src/researchSettings.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const list = (src: string, name: string): string[] => JSON.parse(new RegExp(`${name} = (\\[[^\\]]*\\])`).exec(src)?.[1]?.replace(/\.\.\.RESEARCH_EVIDENCE, /, '"peerReviewed", "controlledTest", "expert", ') ?? '[]') as string[];

describe('research settings (docs/api/research.md §1f)', () => {
  it("lists match the worker's, each with a label", () => {
    expect([...RESEARCH_LEVERS]).toEqual(list(research, 'RESEARCH_LEVERS'));
    expect([...RESEARCH_SCOPES]).toEqual(list(research, 'RESEARCH_SCOPES'));
    expect([...RESEARCH_MODES]).toEqual(list(settings, 'RESEARCH_MODES'));
    expect([...OWN_EVIDENCE]).toEqual(list(settings, 'OWN_EVIDENCE'));
    expect(Object.keys(LEVER_LABELS)).toEqual([...RESEARCH_LEVERS]);
    expect(Object.keys(SCOPE_LABELS)).toEqual([...RESEARCH_SCOPES]);
    expect(Object.keys(MODE_LABELS)).toEqual([...RESEARCH_MODES]);
    expect(Object.keys(EVIDENCE_LABELS)).toEqual([...OWN_EVIDENCE]);
  });
  it("the person's choice beats the workspace's default, which beats the finding's own", () => {
    const rule = { key: 'sourStrong', experiment: false } as BuiltInFinding;
    const trial = { key: 'coldBloom', experiment: true } as BuiltInFinding;
    expect(effectiveMode(rule, null, null)).toBe('on');
    expect(effectiveMode(trial, null, null)).toBe('experiment');
    const ws: ResearchSettings = { settings: { sourStrong: { mode: 'off', note: null }, coldBloom: { mode: 'on', note: null } }, own: [] };
    expect(effectiveMode(rule, null, ws)).toBe('off');
    expect(effectiveMode(trial, null, ws)).toBe('on');
    const me: ResearchSettings = { settings: { sourStrong: { mode: 'experiment', note: 'skews my V60' } }, own: [] };
    expect(effectiveMode(rule, me, ws)).toBe('experiment');
    expect(effectiveMode(trial, me, ws)).toBe('on');
  });
  it('says what a finding still needs before it can be saved', () => {
    const limits = { title: 80, text: 600, source: 300 };
    const ok = { title: 'Slower pours', text: 'Slower pours gave more sweetness.', levers: ['agitation' as const], evidence: 'own' as const, scope: 'pourOver' as const, source: null, mode: 'on' as const };
    expect(findingProblem(ok, limits)).toBeNull();
    expect(findingProblem({ ...ok, title: ' ' }, limits)).toMatch(/title/);
    expect(findingProblem({ ...ok, text: 'x'.repeat(601) }, limits)).toMatch(/600/);
    expect(findingProblem({ ...ok, levers: [] }, limits)).toMatch(/lever/);
  });
});
