<script setup lang="ts">
// Before a backup or an export with AI suggestions in it (docs/api/backup.md
// §2b, "What was sent to the AI"): include what each one was sent, or not.
import ConfirmDialog from './ConfirmDialog.vue';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ choose: [aiRequests: boolean]; cancel: [] }>();
</script>

<template>
  <ConfirmDialog :open="open" title="Include what was sent to the AI?" @cancel="emit('cancel')">
    <p>
      Each AI suggestion keeps the instructions and brew details it was sent. They're only for looking back at, and make the file much
      bigger. The suggestions themselves are in the file either way.
    </p>
    <template #actions>
      <button class="btn btn-primary" type="button" @click="emit('choose', false)">Download without them</button>
      <button class="btn btn-secondary" type="button" @click="emit('choose', true)">Include them</button>
      <button class="btn-link" type="button" @click="emit('cancel')">Cancel</button>
    </template>
  </ConfirmDialog>
</template>
