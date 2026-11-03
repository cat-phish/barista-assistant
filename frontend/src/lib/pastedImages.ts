// The image files among what was pasted (clipboardData.items) or dropped
// (dataTransfer.files) on the AI chat (StatsChatView.vue), so they go up like
// a picked photo. Anything else, such as pasted text, is left alone.

// The parts of a DataTransferItem this reads.
export interface TransferItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

export function pastedImages(items: ArrayLike<TransferItem>): File[] {
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function droppedImages(files: ArrayLike<File>): File[] {
  return Array.from(files).filter((f) => f.type.startsWith('image/'));
}
