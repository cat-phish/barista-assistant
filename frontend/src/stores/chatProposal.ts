import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ChatProposal } from '../api/chats';

// A chat proposal on its way to the page it fills in (docs/api/chat.md §12,
// "Proposals"): the card hands it over and opens the page with ?proposal,
// which takes it once. A reload loses it, and the page starts as usual.
export const useChatProposalStore = defineStore('chatProposal', () => {
  const pending = ref<ChatProposal | null>(null);
  function give(p: ChatProposal): void {
    pending.value = p;
  }
  function take<K extends ChatProposal['kind']>(kind: K): Extract<ChatProposal, { kind: K }> | null {
    const p = pending.value;
    pending.value = null;
    return p && p.kind === kind ? (p as Extract<ChatProposal, { kind: K }>) : null;
  }
  return { pending, give, take };
});
