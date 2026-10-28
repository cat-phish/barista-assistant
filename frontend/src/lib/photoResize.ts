// Shrinks a photo in the browser before it's sent to be read
// (docs/api/bean-label.md §4d): at most 1024 px on the long edge, JPEG,
// base64 without the data: prefix. The server re-encodes it anyway; this
// keeps a phone's 12 MP photo from being uploaded whole.
const MAX_EDGE = 1024;

export async function photoBase64(image: Blob): Promise<string> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t prepare the photo');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.85);
    return url.slice(url.indexOf(',') + 1);
  } finally {
    bitmap.close();
  }
}
