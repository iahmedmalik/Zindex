import { expect, test, type Page } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

// The saved picture must look like the screen. "Save to gallery" makes a PNG of the paper with
// html-to-image; here the picture is caught as a download (the test hides the share sheet) and
// compared with a screenshot of the same paper: same shape, and almost the same pixels.

async function openInvoice(page: Page) {
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: undefined }); });
  await signIn(page);
  await createOrder(page, { name: "Picture Buyer", rider: "300", discount: 10 });
  await page.getByRole("button", { name: "Make invoice" }).click();
  await page.getByRole("button", { name: "Finalise" }).click();
  await expect(page.getByText(/^SF-\d{4}$/)).toBeVisible();
  await page.getByRole("link", { name: /View, print or share the invoice/ }).click();
  await expect(page.locator("article.ivp")).toBeVisible();
}

/** Mean absolute difference per colour channel (0 to 255) between two PNGs, both drawn at the first one's size. */
async function difference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(async ([x, y]) => {
    const load = (b64: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${b64}`; });
    const [ia, ib] = await Promise.all([load(x!), load(y!)]);
    const w = ia.naturalWidth, h = ia.naturalHeight;
    const read = (img: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
    const da = read(ia), db = read(ib);
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) sum += Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!);
    return sum / ((da.length / 4) * 3);
  }, [a.toString("base64"), b.toString("base64")] as const);
}

for (const size of ["A4", "Compact"] as const) {
  test(`the saved ${size} picture matches the paper on screen`, async ({ page }) => {
    await openInvoice(page);
    if (size === "A4") await page.getByRole("radio", { name: "A4" }).check({ force: true });
    const paper = page.locator("article.ivp");
    await expect(paper).toHaveClass(size === "A4" ? /a4/ : /compact/);
    await page.waitForTimeout(600); // the size change is a view transition

    // The sticky bars and toasts sit on top of the page, not on the paper: keep them out of the screenshot.
    await page.addStyleTag({ content: ".bar, .tabs, .toast, nextjs-portal { visibility: hidden !important; }" });
    await paper.scrollIntoViewIfNeeded();
    const box = (await paper.boundingBox())!;
    const screen = await paper.screenshot({ scale: "device", animations: "disabled" });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save to gallery" }).click();
    const file = await (await download).path();
    const saved = (await import("node:fs")).readFileSync(file!);
    if (process.env.KEEP_SHOTS) {
      (await import("node:fs")).writeFileSync(`${process.env.KEEP_SHOTS}/saved-${size}.png`, saved);
      (await import("node:fs")).writeFileSync(`${process.env.KEEP_SHOTS}/screen-${size}.png`, screen);
    }

    // Same shape: the picture is the paper at pixel ratio 2 (within a couple of pixels).
    const dims = await page.evaluate(async (b64) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, saved.toString("base64"));
    expect(Math.abs(dims[0]! - box.width * 2)).toBeLessThanOrEqual(4);
    expect(Math.abs(dims[1]! - box.height * 2)).toBeLessThanOrEqual(6);
    // Same look: the gradient header is in the picture, not a blank or white block.
    const header = await page.evaluate(async (b64) => {
      const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode();
      const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext("2d")!; g.drawImage(i, 0, 0);
      const p = g.getImageData(40, 40, 1, 1).data; return [p[0]!, p[1]!, p[2]!];
    }, saved.toString("base64"));
    expect(Math.min(...header)).toBeLessThan(150); // dark brand colour, not white
    const diff = await difference(page, screen, saved);
    test.info().annotations.push({ type: "mean difference (0-255)", description: diff.toFixed(2) });
    expect(diff).toBeLessThan(8);
  });
}
