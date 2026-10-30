// Optional start countdown (docs/timer_architecture.md §3). A late callback
// starts at the deadline, so background throttling cannot lengthen the delay.
import { ref } from 'vue';

export function useStartDelay(onStart: (at: number) => void) {
  const remaining = ref(0);
  let deadline: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    deadline = null;
    remaining.value = 0;
  }
  function begin(at: number): void {
    cancel();
    onStart(at);
  }
  function tick(): void {
    if (deadline === null) return;
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining.value === 0) begin(deadline);
    else timeout = setTimeout(tick, Math.min(50, deadline - Date.now()));
  }
  function start(seconds: 0 | 3 | 5): void {
    if (deadline !== null || seconds === 0) begin(Date.now());
    else {
      deadline = Date.now() + seconds * 1000;
      tick();
    }
  }
  return { remaining, start, cancel };
}
