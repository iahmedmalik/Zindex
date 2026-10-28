// Turns the on-screen invoice paper into a PNG, the same picture the customer is sent.
// Fonts are awaited first, or the image would be drawn in the fallback font.
export async function invoiceImage(paper: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(paper, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
  if (!blob) throw new Error("The image could not be made.");
  return blob;
}

/** Opens the phone's share sheet with the picture (Save image, WhatsApp, ...). Returns false when this device has no share sheet for files. */
export async function shareImage(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (!nav.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: name });
  } catch (err) {
    if ((err as Error).name !== "AbortError") throw err;
  }
  return true;
}

export function downloadImage(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
