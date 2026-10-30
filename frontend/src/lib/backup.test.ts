import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { BackupFile } from '../api/backup';
import { backupFileName, backupSummary, copyExample, detailsText, exportFileName, fileLists, hasAiSuggestions, isZip, missingListError, readBackup, readBackupZip, tableLabel } from './backup';

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
    expect(exportFileName(file, ['recipes', 'water_profiles'])).toBe('home-bar-recipes-water-profiles-2026-10-23.json');
  });
  it('names tables and the rows that come along', () => {
    expect([tableLabel('brew_logs'), tableLabel('recipe_styles'), tableLabel('something_new')]).toEqual(['Journal (brews)', 'Recipe styles', 'something new']);
    expect(detailsText({ recipe_steps: 4, recipe_grind_settings: 2 })).toBe('4 recipe steps · 2 grind starting points');
  });

  it('knows which lists a file can import: an export says, a backup has the ones with rows', () => {
    expect(fileLists(file)).toEqual(['beans', 'grinders', 'brew_logs']);
    const recipes: BackupFile = { ...file, scope: 'lists', lists: ['drinks', 'recipes'], tables: { recipes: [{}], brewers: [{}], drinks: [{}] } };
    expect(fileLists(recipes)).toEqual(['recipes', 'drinks']); // brewers only came along
  });

  it('shows the copy name with an item from the file: a bean by its bean name, never a brew', () => {
    const beans: BackupFile = { ...file, tables: { beans: [{ roasterName: 'Test Roaster', beanName: 'Test Bean' }], brew_logs: [{}] } };
    expect(copyExample(beans, ['beans'])).toBe('Test Bean (2)');
    expect(copyExample({ ...file, tables: { recipes: [{ name: 'House V60' }] } }, ['recipes'])).toBe('House V60 (2)');
    expect(copyExample(beans, ['brew_logs'])).toBe('Name (2)');
    expect(copyExample(beans, ['brew_logs', 'beans'])).toBe('Test Bean (2)');
  });

  it("explains a file a list page can't import", () => {
    expect(missingListError(file, 'beans')).toBeNull();
    expect(missingListError(file, 'recipes')).toBe('This file has no recipes (it has beans, grinders, journal (brews)); import it from Settings → Data.');
    expect(missingListError({ ...file, tables: {} }, 'drinks')).toBe('This file has no drinks.');
  });
});

describe('hasAiSuggestions (asks whether to include what was sent to the AI)', () => {
  it('for brews and beans, which carry analyses and suggested parameters', () => {
    expect(hasAiSuggestions(['brew_logs'])).toBe(true);
    expect(hasAiSuggestions(['recipes', 'beans'])).toBe(true);
    expect(hasAiSuggestions(['recipes', 'grinders', 'drinks'])).toBe(false);
  });
});

describe('readBackupZip', () => {
  it('reads backup.json from a .zip backup, with its photos counted', () => {
    const withPhotos = { ...file, tables: { ...file.tables, bean_photos: [{}, {}] } };
    const zip = zipSync({ 'backup.json': strToU8(JSON.stringify(withPhotos)), 'photos/x.webp': new Uint8Array([1, 2]) });
    const read = readBackupZip(zip);
    expect(read).toMatchObject({ ok: true, file: { workspace: { slug: 'home-bar' } } });
    expect(read.ok && backupSummary(read.file)).toBe('2 brews · 1 bean · 1 grinder · 2 photos');
  });
  it("says what's wrong with a zip that isn't a backup", () => {
    expect(readBackupZip(strToU8('nope'))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a zip/) });
    expect(readBackupZip(zipSync({ 'a.txt': strToU8('hi') }))).toMatchObject({ ok: false, error: expect.stringMatching(/no backup\.json/) });
    expect(readBackupZip(zipSync({ 'backup.json': strToU8('{}') }))).toMatchObject({ ok: false });
  });
  it('tells a zip by its name', () => {
    expect(isZip('home-bar-backup.ZIP')).toBe(true);
    expect(isZip('home-bar-backup.json')).toBe(false);
  });
});
