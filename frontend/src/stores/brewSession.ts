import { defineStore } from 'pinia';
import { ref } from 'vue';

// Lets the header's Brew link reach the brew screen: on /brew, clicking Brew
// again is a same-route navigation (ignored by the router), so the header
// asks the brew screen to start over instead (it asks first mid-brew).
export const useBrewSessionStore = defineStore('brewSession', () => {
  const inProgress = ref(false); // timer running or an unsaved log (set by BrewView)
  const restartRequests = ref(0); // bumped by the header; BrewView watches it
  function requestRestart(): void {
    restartRequests.value++;
  }
  return { inProgress, restartRequests, requestRestart };
});
