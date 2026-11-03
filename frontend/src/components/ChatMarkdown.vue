<script setup lang="ts">
// An AI chat reply, formatted (lib/markdown.ts). Drawn as elements, never
// v-html: everything the model wrote reaches the page as text.
import { computed, h, type VNode } from 'vue';
import { parseMarkdown, type Block, type Inline, type ListBlock } from '../lib/markdown';

const props = defineProps<{ source: string }>();

function inlines(nodes: Inline[]): Array<VNode | string> {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'break':
        return h('br');
      case 'strong':
        return h('strong', inlines(n.children));
      case 'em':
        return h('em', inlines(n.children));
      case 'code':
        return h('code', n.text);
      case 'link':
        return h('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer nofollow' }, inlines(n.children));
    }
  });
}

function list(l: ListBlock): VNode {
  const items = l.items.map((item) => h('li', [...inlines(item.content), ...(item.sublist ? [list(item.sublist)] : [])]));
  return l.ordered ? h('ol', l.start !== 1 ? { start: l.start } : {}, items) : h('ul', items);
}

function block(b: Block): VNode {
  switch (b.type) {
    case 'paragraph':
      return h('p', inlines(b.content));
    case 'heading':
      return h(`h${b.level + 2}`, inlines(b.content));
    case 'list':
      return list(b);
    case 'quote':
      return h('blockquote', b.blocks.map(block));
    case 'code':
      return h('pre', [h('code', b.text)]);
    case 'rule':
      return h('hr');
    case 'table':
      return h('div', { class: 'table-wrap' }, [
        h('table', [
          h('thead', [h('tr', b.head.map((cell, c) => h('th', { scope: 'col', style: b.align[c] ? { textAlign: b.align[c] } : undefined }, inlines(cell))))]),
          h('tbody', b.rows.map((row) => h('tr', row.map((cell, c) => h('td', { style: b.align[c] ? { textAlign: b.align[c] } : undefined }, inlines(cell)))))),
        ]),
      ]);
  }
}

const tree = computed(() => parseMarkdown(props.source).map(block));
const Rendered = () => tree.value;
</script>

<template>
  <div class="md"><Rendered /></div>
</template>

<style scoped>
.md {
  overflow-wrap: anywhere;
}
.md > :deep(:first-child) {
  margin-top: 0;
}
.md > :deep(:last-child) {
  margin-bottom: 0;
}
.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(pre),
.md :deep(blockquote),
.md :deep(.table-wrap) {
  margin: 0 0 var(--space-2);
}
.md :deep(h3),
.md :deep(h4),
.md :deep(h5) {
  margin: var(--space-3) 0 var(--space-1);
  font-size: 1rem;
}
.md :deep(h3) {
  font-size: 1.1rem;
}
.md :deep(ul),
.md :deep(ol) {
  padding-left: 1.4em;
}
.md :deep(li + li) {
  margin-top: 2px;
}
.md :deep(li > ul),
.md :deep(li > ol) {
  margin: 2px 0 0;
}
.md :deep(code) {
  padding: 0 0.3em;
  border-radius: 4px;
  background: var(--brand-tint);
  font-size: 0.9em;
}
.md :deep(pre) {
  padding: var(--space-2);
  overflow-x: auto;
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.md :deep(pre code) {
  padding: 0;
  background: none;
  white-space: pre;
  overflow-wrap: normal;
}
.md :deep(blockquote) {
  padding-left: var(--space-2);
  border-left: 3px solid var(--brand-line);
  color: var(--text-muted);
}
.md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: var(--space-3) 0;
}
.md :deep(.table-wrap) {
  overflow-x: auto;
}
.md :deep(table) {
  border-collapse: collapse;
  font-size: 0.9rem;
}
.md :deep(th),
.md :deep(td) {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.md :deep(th) {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 600;
}
.md :deep(a) {
  color: var(--brand);
}
</style>
