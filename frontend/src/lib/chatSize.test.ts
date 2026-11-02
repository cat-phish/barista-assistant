import { describe, expect, it } from 'vitest';
import { formatBytes, fromBytes, toBytes } from './chatSize';

describe('chat sizes', () => {
  it('converts to bytes', () => {
    expect(toBytes(1, 'GB')).toBe(1073741824);
    expect(toBytes(1.5, 'MB')).toBe(1572864);
  });
  it('picks the largest unit', () => {
    expect(fromBytes(1073741824)).toEqual({ value: 1, unit: 'GB' });
    expect(fromBytes(2048)).toEqual({ value: 2, unit: 'KB' });
    expect(fromBytes(1572864)).toEqual({ value: 1.5, unit: 'MB' });
  });
  it('shows small sizes in bytes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(5120)).toBe('5 KB');
  });
});
