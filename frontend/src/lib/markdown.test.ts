import { describe, expect, it } from 'vitest';
import { inline, parseMarkdown } from './markdown';

const text = (t: string) => ({ type: 'text', text: t });

describe('inline', () => {
  it('reads bold, italic, code and links', () => {
    expect(inline('a **b** *c* `d`')).toEqual([text('a '), { type: 'strong', children: [text('b')] }, text(' '), { type: 'em', children: [text('c')] }, text(' '), { type: 'code', text: 'd' }]);
    expect(inline('__bold__ and _it_')).toEqual([{ type: 'strong', children: [text('bold')] }, text(' and '), { type: 'em', children: [text('it')] }]);
    expect(inline('see [SCA](https://sca.coffee/x)')).toEqual([text('see '), { type: 'link', href: 'https://sca.coffee/x', children: [text('SCA')] }]);
  });

  it('nests italic inside bold', () => {
    expect(inline('**very *fine* grind**')).toEqual([{ type: 'strong', children: [text('very '), { type: 'em', children: [text('fine')] }, text(' grind')] }]);
  });

  it('keeps a link that is not http(s) as its text', () => {
    expect(inline('[click](javascript:alert(1))').some((n) => n.type === 'link')).toBe(false);
    expect(inline('[x](javascript:void)')).toEqual([text('x')]);
    expect(inline('[x](data:text/html,hi)')).toEqual([text('x')]);
  });

  it('leaves HTML, half-written markup, snake_case and stray stars as text', () => {
    expect(inline('<img src=x onerror=alert(1)>')).toEqual([text('<img src=x onerror=alert(1)>')]);
    expect(inline('**half')).toEqual([text('**half')]);
    expect(inline('a `b')).toEqual([text('a `b')]);
    expect(inline('grind_size_setting')).toEqual([text('grind_size_setting')]);
    expect(inline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
  });

  it('turns a line break into a break, and reads escapes', () => {
    expect(inline('a\nb')).toEqual([text('a'), { type: 'break' }, text('b')]);
    expect(inline('\\*not italic\\*')).toEqual([text('*not italic*')]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and reads headings and rules', () => {
    expect(parseMarkdown('# Title\n\nOne\ntwo\n\n---\nThree')).toEqual([
      { type: 'heading', level: 1, content: [text('Title')] },
      { type: 'paragraph', content: [text('One'), { type: 'break' }, text('two')] },
      { type: 'rule' },
      { type: 'paragraph', content: [text('Three')] },
    ]);
    expect(parseMarkdown('#### Deep')[0]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('reads lists, numbered ones from their start, with one level of nesting', () => {
    const [list] = parseMarkdown('- a\n- b\n  - b1\n  - b2\n- c');
    expect(list).toMatchObject({ type: 'list', ordered: false, items: [{ content: [text('a')], sublist: null }, { content: [text('b')] }, { content: [text('c')] }] });
    expect(list!.type === 'list' && list.items[1]!.sublist?.items.map((x) => x.content)).toEqual([[text('b1')], [text('b2')]]);
    expect(parseMarkdown('3. x\n4. y')[0]).toMatchObject({ type: 'list', ordered: true, start: 3, items: [{}, {}] });
  });

  it('keeps a list going over a blank line, and ends it at a paragraph', () => {
    expect(parseMarkdown('1. a\n\n2. b\n\nAfter')).toMatchObject([{ type: 'list', items: [{}, {}] }, { type: 'paragraph' }]);
  });

  it('reads a pipe table, with alignment and short rows filled', () => {
    expect(parseMarkdown('| Brew | Rating |\n|:--|--:|\n| V60 | 4 |\n| Kalita |')).toEqual([
      {
        type: 'table',
        align: ['left', 'right'],
        head: [[text('Brew')], [text('Rating')]],
        rows: [
          [[text('V60')], [text('4')]],
          [[text('Kalita')], []],
        ],
      },
    ]);
  });

  it('keeps code as it is, and shows a fence still being written as code', () => {
    expect(parseMarkdown('```js\nconst a = **1**;\n```\nafter')).toEqual([{ type: 'code', lang: 'js', text: 'const a = **1**;' }, { type: 'paragraph', content: [text('after')] }]);
    expect(parseMarkdown('```\nhalf')).toEqual([{ type: 'code', lang: '', text: 'half' }]);
  });

  it('reads quotes', () => {
    expect(parseMarkdown('> a\n> **b**')).toEqual([{ type: 'quote', blocks: [{ type: 'paragraph', content: [text('a'), { type: 'break' }, { type: 'strong', children: [text('b')] }] }] }]);
  });

  it('is nothing for an empty reply', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });
});
