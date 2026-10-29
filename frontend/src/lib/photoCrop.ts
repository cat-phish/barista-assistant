// Cropping a photo (components/PhotoCropDialog.vue): what comes back is a
// new file, swapped in for the one that was there.

export interface HeldPhoto<K> {
  key: K;
  file: File;
  url: string; // an object URL for the file, shown in the tile
}

// The cropped image as a file: the old name with .jpg (the editor writes JPEG).
export function croppedFile(blob: Blob, original: string): File {
  const base = original.replace(/\.[^./]+$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: blob.type || 'image/jpeg' });
}

// The list with `key`'s file replaced in place (same key, so order and drafts
// hold), and the old URL for the caller to revoke.
export function replaceFile<K, T extends HeldPhoto<K>>(
  list: readonly T[],
  key: K,
  file: File,
  makeUrl: (file: File) => string = (f) => URL.createObjectURL(f),
): { list: T[]; revoke: string | null } {
  const old = list.find((p) => p.key === key);
  if (!old) return { list: [...list], revoke: null };
  const url = makeUrl(file);
  return { list: list.map((p) => (p.key === key ? { ...p, file, url } : p)), revoke: old.url };
}
