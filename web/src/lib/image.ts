// A phone photo can be several MB. The server takes at most 600 KB, so the photo is shrunk here first:
// scaled to fit 1024 px and saved as JPEG, lowering the quality until it is small enough.

const LIMIT = 500 * 1024;

export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.58, 0.46, 0.34]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= LIMIT) return blob;
  }
  throw new Error("That photo is too large even after shrinking. Try another one.");
}

/** Sends the photo to the API as raw JPEG bytes (the JSON helper cannot). */
export async function uploadPhoto(path: string, photo: Blob): Promise<void> {
  const res = await fetch(`/backend/v1${path}`, { method: "PUT", headers: { "Content-Type": photo.type || "image/jpeg" }, body: photo, credentials: "same-origin" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "The photo could not be saved.");
  }
}

/**
 * A store's logo or watermark: scaled to fit `side` px and kept as WebP (PNG where the browser cannot make WebP), so a
 * transparent background stays transparent. The server takes at most 300 KB, so the quality is lowered until it fits.
 */
export async function shrinkPicture(file: File, side: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the picture.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.92, 0.8, 0.66, 0.5, 0.36]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.type === "image/webp" && blob.size <= 280 * 1024) return blob;
    if (blob && blob.type === "image/png") { if (blob.size <= 280 * 1024) return blob; break; }
  }
  throw new Error("That picture is too large even after shrinking. Try a simpler one.");
}
