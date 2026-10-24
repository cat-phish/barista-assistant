import { describe, expect, it } from 'vitest';
import type { BackupFile } from '../api/backup';
import { backupFileName, backupSummary, readBackup } from './backup';

const file: BackupFile = {
  format: 'barista-backup',
  version: 1,
  exportedAt: '2026-10-23T08:00:00.000Z',
  workspace: { name: 'Home bar', slug: 'home-bar' },
  tables: { brew_logs: [{}, {}], beans: [{}], recipes: [], grinders: [{}] },
};

describe('backup files', () => {
  it('reads a backup, and says what else a file is', () => {
    expect(readBackup(JSON.stringify(file))).toEqual({ ok: true, file });
    expect(readBackup('not json')).toEqual({ ok: false, error: "That file isn't a backup (it isn't JSON)." });
    expect(readBackup('{"format":"other"}')).toEqual({ ok: false, error: "That file isn't a Barista backup." });
    expect(readBackup('null').ok).toBe(false);
  });
  it('sums up what it holds and names the download', () => {
    expect(backupSummary(file)).toBe('2 brews · 1 bean · 1 grinder');
    expect(backupFileName(file)).toBe('home-bar-backup-2026-10-23.json');
  });
});
