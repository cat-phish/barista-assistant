<script setup lang="ts">
// Icons from Lucide (lucide.dev, lucide-static 1.74.0), ISC licence; the
// notice is in LICENSE-lucide.txt beside this file. Copied in as paths, so
// there's no extra download and they take the text colour (light or dark).
// To add one: copy its inner elements from lucide-static/icons/<name>.svg.
export type IconName = keyof typeof ICONS;

const ICONS = {
  play: ['<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />'],
  share: ['<path d="M12 2v13" />', '<path d="m16 6-4-4-4 4" />', '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />'],
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
  'trending-up': ['<path d="M16 7h6v6" />', '<path d="m22 7-8.5 8.5-5-5L2 17" />'],
  'trending-down': ['<path d="M16 17h6v-6" />', '<path d="m22 17-8.5-8.5-5 5L2 7" />'],
  minus: ['<path d="M5 12h14" />'],
  trophy: [
    '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" />',
    '<path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" />',
    '<path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" />',
    '<path d="M4 22h16" />',
    '<path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />',
    '<path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />',
  ],
} as const;

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 });
</script>

<template>
  <!-- v-html: fixed paths from the table above, never user input -->
  <svg aria-hidden="true" viewBox="0 0 24 24" :width="props.size" :height="props.size" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS[props.name].join('')" />
</template>
