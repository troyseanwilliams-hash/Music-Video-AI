// Run against an already running headless Chromium with remote debugging.
// Checks only the public guide; never signs in or submits paid actions.
import { writeFile, mkdir } from "node:fs/promises";
const endpoint = process.env.CDP_URL || "http://127.0.0.1:9223";
const target = (await (await fetch(`${endpoint}/json`)).json()).find(t => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", ({ data }) => {
  const result = JSON.parse(data);
  if (pending.has(result.id)) {
    const { resolve, reject } = pending.get(result.id);
    pending.delete(result.id);
    result.error ? reject(result.error) : resolve(result.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const wait = async expression => {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error(`Timed out: ${expression}`);
};
await mkdir("generated-artifacts/guide-layout", { recursive: true });
try {
  for (const [width, height] of [[390, 700], [320, 568], [1440, 900]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: process.env.APP_URL || "http://127.0.0.1:80/editor" });
    await wait('!!document.querySelector("[data-testid=button-help-create]")');
    await evaluate('document.querySelector("[data-testid=button-help-create]").click()');
    await wait('!!document.querySelector("[data-testid=dialog-creation-guide]")');
    await new Promise(r => setTimeout(r, 600));
    const result = await evaluate(`(() => {
      const dialog = document.querySelector('[data-testid=dialog-creation-guide]');
      const list = document.querySelector('[data-testid=creation-goal-list]');
      const cards = [...list.querySelectorAll('button')];
      const rects = cards.map(c => c.getBoundingClientRect());
      const bounds = dialog.getBoundingClientRect();
      return {
        cards: cards.length,
        noOverlap: rects.every((r,i) => !i || r.top >= rects[i-1].bottom),
        textContained: cards.every(c => c.querySelector('p').getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom),
        fitsViewport: bounds.left >= -1 && bounds.right <= innerWidth+1 && bounds.top >= -1 && bounds.bottom <= innerHeight+1,
        noHorizontalOverflow: list.scrollWidth <= list.clientWidth+1,
        scrollable: list.scrollHeight > list.clientHeight
      };
    })()`);
    console.log(`${width}x${height}`, result);
    if (result.cards !== 7 || !result.noOverlap || !result.textContained || !result.fitsViewport || !result.noHorizontalOverflow) {
      throw Error("Layout check failed");
    }
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`generated-artifacts/guide-layout/${width}.png`, Buffer.from(image.data, "base64"));
    const reachedEnd = await evaluate(`(() => {
      const list = document.querySelector('[data-testid=creation-goal-list]');
      list.scrollTop = list.scrollHeight;
      const card = document.querySelector('[data-testid=goal-animate-photo]').getBoundingClientRect();
      const region = list.getBoundingClientRect();
      return card.bottom <= region.bottom+1 && card.top >= region.top;
    })()`);
    if (!reachedEnd) throw Error("Last option cannot be reached");
    await evaluate(`[...document.querySelectorAll('[data-testid=dialog-creation-guide] button')].find(b => b.textContent === 'Skip for now').click()`);
    await wait('!document.querySelector("[data-testid=dialog-creation-guide]")');
  }
} finally {
  ws.close();
}
