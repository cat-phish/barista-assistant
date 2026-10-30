// A new service worker reloads the page when it takes over, and a brew in
// progress lives only in memory until it's saved: so an update found mid-brew
// waits until the brew is saved or abandoned (docs/timer_architecture.md §2).
export interface UpdateGate {
  /** A new version is waiting: apply it now, or once not busy. */
  ready(): void;
  setBusy(busy: boolean): void;
}

export function createUpdateGate(apply: () => void): UpdateGate {
  let busy = false;
  let waiting = false;
  function flush(): void {
    if (!waiting || busy) return;
    waiting = false;
    apply();
  }
  return {
    ready() {
      waiting = true;
      flush();
    },
    setBusy(b) {
      busy = b;
      flush();
    },
  };
}
