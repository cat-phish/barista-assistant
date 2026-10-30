import { describe, expect, it, vi } from 'vitest';
import { createUpdateGate } from './swUpdate';

describe('createUpdateGate', () => {
  it('applies an update at once when no brew is running', () => {
    const apply = vi.fn();
    createUpdateGate(apply).ready();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('holds an update found mid-brew until the brew ends', () => {
    const apply = vi.fn();
    const gate = createUpdateGate(apply);
    gate.setBusy(true);
    gate.ready();
    expect(apply).not.toHaveBeenCalled();
    gate.setBusy(true); // e.g. timer → log form
    expect(apply).not.toHaveBeenCalled();
    gate.setBusy(false);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('does nothing when a brew ends with no update waiting', () => {
    const apply = vi.fn();
    const gate = createUpdateGate(apply);
    gate.setBusy(true);
    gate.setBusy(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a held update only once', () => {
    const apply = vi.fn();
    const gate = createUpdateGate(apply);
    gate.setBusy(true);
    gate.ready();
    gate.ready();
    gate.setBusy(false);
    gate.setBusy(true);
    gate.setBusy(false);
    expect(apply).toHaveBeenCalledOnce();
  });
});
