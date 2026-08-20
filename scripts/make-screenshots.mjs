/**
 * Capture the README screenshots from the running workspace.
 *
 * Drives a headless Chrome over the DevTools protocol directly: no browser
 * automation dependency to declare in the SBOM, no window opening on the
 * machine that runs it, and the shots come from the same dev server a
 * developer sees.
 *
 * The conversion on screen is real. `src/dev/host.ts` answers with output
 * Philon's own engine produced, so a screenshot cannot flatter the interface
 * with data the program could not have made.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/make-screenshots.mjs [outputDir]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const APP = "http://localhost:1420";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const OUT = process.argv[2] || "docs/screenshots";

const SEEN_KEY = "philon.splash.seen.v1";
const dismiss = `document.querySelector('.splash-continue')?.click();`;
const load = `const open = document.querySelector('.open-document-button'); if (open) open.click();`;
const convert = `const c = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Convert'); if (c && !c.disabled) c.click();`;
const view = (name) => `[...document.querySelectorAll('.main-tabs button')].find(b => b.textContent.trim().startsWith('${name}'))?.click();`;

/** Each shot: where to point the viewport, and what to do before the click. */
const SHOTS = [
  { name: "splash", width: 1280, height: 760, steps: [`localStorage.removeItem('${SEEN_KEY}')`, "location.reload()"], settle: 1400 },
  { name: "workspace", width: 1680, height: 1000, steps: [dismiss, load, convert], settle: 1800 },
  { name: "models", width: 1680, height: 700, steps: [view("Models")], settle: 900 },
  { name: "settings", width: 1680, height: 980, steps: [view("Settings")], settle: 700 },
  { name: "library", width: 1680, height: 700, steps: [view("Library")], settle: 900 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function devtools(path) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return response.json();
}

function session(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message.result ?? {});
  });
  return (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*",
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--user-data-dir=/tmp/philon-shots", "about:blank",
  ], { stdio: "ignore" });

  try {
    let target;
    for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
      await sleep(200);
      try { target = (await devtools("/json/list")).find((item) => item.type === "page"); } catch { /* not up yet */ }
    }
    if (!target) throw new Error("Chrome did not expose a debugging target.");

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const send = session(socket);
    await send("Page.enable");
    await send("Runtime.enable");

    await send("Page.navigate", { url: APP });
    await sleep(2000);

    for (const shot of SHOTS) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: false,
      });
      for (const step of shot.steps) {
        await send("Runtime.evaluate", { expression: step, awaitPromise: true });
        await sleep(600);
      }
      await sleep(shot.settle);
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const file = join(OUT, `${shot.name}.png`);
      await writeFile(file, Buffer.from(data, "base64"));
      console.log(`${file}  ${shot.width}x${shot.height} @2x`);
    }
    socket.close();
  } finally {
    chrome.kill();
  }
}

await main();
