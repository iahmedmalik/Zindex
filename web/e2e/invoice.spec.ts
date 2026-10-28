import { expect, test, type Page } from "@playwright/test";
import { createOrder, signIn } from "./helpers";

// The saved picture must look like the screen. "Save to gallery" makes a PNG of the paper with
// html-to-image; here the picture is caught as a download (the test hides the share sheet) and
// compared with a screenshot of the same paper: same shape, and almost the same pixels.

async function openInvoice(page: Page) {
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: undefined }); });
  await signIn(page);
  await createOrder(page, { name: "Picture Buyer", rider: "300", discount: 10 });
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

    // Same shape, and sharp: the picture keeps the paper's proportions and is drawn at least 1,400 pixels wide
    // (a 2x picture of the compact receipt was only about 720 and looked soft next to the PDF).
    const dims = await page.evaluate(async (b64) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, saved.toString("base64"));
    expect(dims[0]!).toBeGreaterThanOrEqual(1400);
    expect(Math.abs(dims[0]! / dims[1]! - box.width / box.height) / (box.width / box.height)).toBeLessThan(0.01);
    // Same look: the gradient header is in the picture, not a blank or white block, and it reaches the corners
    // (rounded corners left white triangles at the top of the picture).
    const header = await page.evaluate(async (b64) => {
      const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode();
      const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext("2d")!; g.drawImage(i, 0, 0);
      const px = (x: number, y: number) => { const p = g.getImageData(x, y, 1, 1).data; return Math.min(p[0]!, p[1]!, p[2]!); };
      return { inside: px(40, 40), topLeft: px(1, 1), topRight: px(i.naturalWidth - 2, 1) };
    }, saved.toString("base64"));
    expect(header.inside).toBeLessThan(150); // dark brand colour, not white
    expect(header.topLeft).toBeLessThan(150);
    expect(header.topRight).toBeLessThan(150);
    const diff = await difference(page, screen, saved);
    test.info().annotations.push({ type: "mean difference (0-255)", description: diff.toFixed(2) });
    expect(diff).toBeLessThan(8);
  });
}

// The browser only opens the share sheet while the tap is still "fresh". If the picture is made after the tap, a slow
// phone runs out of time and the share fails with "Must be handling a user gesture". So the picture must already be
// made, and the share must start inside the tap: here, within 100 ms of the click.
test("Save to gallery and Send on WhatsApp open the share sheet inside the tap, not after the picture is made", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shares: { at: number; files: number }[]; __clickAt: number };
    w.__shares = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: async (d: ShareData) => { w.__shares.push({ at: performance.now(), files: d.files?.length ?? 0 }); }, configurable: true });
    document.addEventListener("click", () => { w.__clickAt = performance.now(); }, true);
  });
  await signIn(page);
  await createOrder(page, { name: "Share Buyer", rider: "300" });
  await page.getByRole("link", { name: /View, print or share the invoice/ }).click();
  await expect(page.locator("article.ivp")).toBeVisible();

  for (const [i, name] of ["Save to gallery", "Send on WhatsApp"].entries()) {
    await page.getByRole("button", { name }).click(); // waits until the button is ready to press
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shares: unknown[] }).__shares.length)).toBe(i + 1);
    const lag = await page.evaluate(() => { const w = window as unknown as { __shares: { at: number }[]; __clickAt: number }; return w.__shares.at(-1)!.at - w.__clickAt; });
    expect(lag, `${name}: the share sheet opened ${Math.round(lag)} ms after the tap`).toBeLessThan(100);
    const files = await page.evaluate(() => (window as unknown as { __shares: { files: number }[] }).__shares.at(-1)!.files);
    expect(files).toBe(1);
  }
});
