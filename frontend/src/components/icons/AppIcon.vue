<script setup lang="ts">
// Icons from Lucide (lucide.dev, lucide-static 1.74.0), ISC licence; the
// notice is in LICENSE-lucide.txt beside this file. Copied in as paths, so
// there's no extra download and they take the text colour (light or dark).
// To add one: copy its inner elements from lucide-static/icons/<name>.svg.
export type IconName = keyof typeof ICONS;

const ICONS = {
  play: ['<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />'],
  pause: ['<rect x="14" y="3" width="5" height="18" rx="1" />', '<rect x="5" y="3" width="5" height="18" rx="1" />'],
  'volume-2': [
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />',
    '<path d="M16 9a5 5 0 0 1 0 6" />',
    '<path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
  ],
  'volume-x': [
    '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" />',
    '<path d="m16.5 14.5 5-5" />',
    '<path d="m16.5 9.5 5 5" />',
  ],
  x: ['<path d="M18 6 6 18" />', '<path d="m6 6 12 12" />'],
} as const;

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 });
</script>

<template>
  <!-- v-html: fixed paths from the table above, never user input -->
  <svg aria-hidden="true" viewBox="0 0 24 24" :width="props.size" :height="props.size" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS[props.name].join('')" />
</template>
