import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../api/chats';
import { beanAttachLabel, brewAttachLabel, countLabel, groupByKind, isPicked, matches, selectAll, toggle, withoutKind } from './chatAttach';

const brew = (id: string): ChatAttachment => ({ kind: 'brew', id, label: id });
const bean = (id: string): ChatAttachment => ({ kind: 'bean', id, label: id });

describe('toggle', () => {
  it('adds while there is room and takes off what is there', () => {
    expect(toggle([], brew('a'), 2)).toEqual([brew('a')]);
    expect(toggle([brew('a'), brew('b')], brew('c'), 2)).toEqual([brew('a'), brew('b')]);
    expect(toggle([brew('a'), brew('b')], brew('a'), 2)).toEqual([brew('b')]);
  });

  it('tells kinds apart with the same id', () => {
    expect(isPicked([brew('x')], bean('x'))).toBe(false);
    expect(toggle([brew('x')], bean('x'), 5)).toEqual([brew('x'), bean('x')]);
  });
});

describe('selectAll', () => {
  it('adds what is not picked yet, in order, and counts what did not fit', () => {
    const { selection, left } = selectAll([brew('a')], [brew('a'), brew('b'), brew('c'), brew('d')], 3);
    expect(selection).toEqual([brew('a'), brew('b'), brew('c')]);
    expect(left).toBe(1);
  });

  it('adds each item once, and nothing when full', () => {
    expect(selectAll([], [brew('a'), brew('a')], 5)).toEqual({ selection: [brew('a')], left: 0 });
    expect(selectAll([brew('a')], [brew('b')], 1)).toEqual({ selection: [brew('a')], left: 1 });
  });
});

describe('groups and labels', () => {
  it('groups by kind, brews first, leaving out empty kinds', () => {
    expect(groupByKind([bean('x'), brew('a'), brew('b')])).toEqual([
      { kind: 'brew', items: [brew('a'), brew('b')] },
      { kind: 'bean', items: [bean('x')] },
    ]);
    expect(withoutKind([bean('x'), brew('a')], 'brew')).toEqual([bean('x')]);
  });

  it('counts and labels as the server does', () => {
    expect(countLabel('brew', 1)).toBe('1 brew');
    expect(countLabel('recipe', 14)).toBe('14 recipes');
    expect(brewAttachLabel({ timestamp: '2026-10-03T08:00:00.000Z', bean: { beanName: 'Guji' } })).toBe('Guji, 2026-10-03');
    expect(beanAttachLabel({ roasterName: 'Onyx', beanName: 'Guji' })).toBe('Onyx Guji');
  });

  it('matches every word, in any case', () => {
    expect(matches('Onyx Guji Natural', 'guji onyx')).toBe(true);
    expect(matches('Onyx Guji', 'kenya')).toBe(false);
    expect(matches('Anything', '  ')).toBe(true);
  });
});
