// claude-bridge-page-test.js -- the page, served by the local bridge
// (Browsered.command), asks Claude through Claude Code: a fake claude here,
// no network and no credentials (make check-web).
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "browsered-claude-"));
const fake = path.join(temp, "claude");
fs.writeFileSync(fake, "#!/bin/sh\nfor last do :; done\ncontext=$(cat)\nprintf 'FAKE-CLAUDE answers %s' \"$last\"\n", { mode: 0o700 });
let failed = 0;
let bridge;
function check(name, ok, detail) { console.log((ok ? "ok    " : "FAIL  ") + name + (ok ? "" : "  " + (detail || ""))); if (!ok) failed++; }
(async () => {
  bridge = spawn(path.join(root, "build/browsered-codex-bridge"),
    ["--serve", "--port", "0", "--page", path.join(root, "Browsered.html")],
    { env: { ...process.env, BROWSERED_CLAUDE: fake, BROWSERED_CODEX: "/nonexistent", ANTHROPIC_API_KEY: "" } });
  let out = "";
  const port = await new Promise((ok, no) => {
    bridge.stdout.on("data", b => { out += b; const m = /127\.0\.0\.1:(\d+)/.exec(out); if (m) ok(Number(m[1])); });
    bridge.stderr.on("data", b => { out += b; });
    bridge.on("exit", c => no(new Error("bridge exited " + c + " " + out)));
  });
  const browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL
    ? { channel: process.env.BROWSERED_TEST_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  let api = 0;
  await page.route("https://api.anthropic.com/**", r => { api++; return r.abort(); });
  const scheme = async expr => {
    await page.evaluate(() => Module.browsered._test = null);
    await page.keyboard.press("Escape"); await page.keyboard.press(":");
    await page.keyboard.type("(web-request \"test-result\" (with-output-to-string (lambda () (write " + expr + "))))");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Module.browsered._test !== null, null, { timeout: 30000 });
    await page.waitForTimeout(150);
    return page.evaluate(() => Module.browsered._test);
  };
  await page.goto("http://127.0.0.1:" + port + "/?advanced");
  await page.waitForTimeout(2500);
  check("the page starts from the bridge", errors.length === 0, errors.join(" "));
  check("Claude goes through the subscription", await scheme("(claude-transport)") === "cli");
  const answer = await scheme("(claude-ask \"What is car?\" \"(car x)\")");
  check("Claude Code answers", answer === JSON.stringify("FAKE-CLAUDE answers What is car?"), answer);
  check("the status names Claude Code", /through Browsered.command/.test(await scheme("(assistant-status-text)")));
  check("no API calls", api === 0);
  // C-x C-c stops the launcher too, even when the tab closes at once
  // (window.close() is left as it is: here it may close the page)
  const stopped = new Promise(ok => bridge.on("exit", ok));
  await page.keyboard.press("Control+x"); await page.keyboard.press("Control+c");
  await page.waitForTimeout(300);
  if (!page.isClosed() && !(await page.locator("#editor-closed").count())) await page.keyboard.press("y");
  const gone = await Promise.race([stopped.then(() => true), new Promise(ok => setTimeout(() => ok(false), 5000))]);
  check("C-x C-c stops the launcher", gone);
  if (!page.isClosed()) {
    await page.waitForTimeout(300);
    check("the closed page says how to start again",
          /Browsered.command has stopped too/.test(await page.locator("#editor-closed").textContent()));
  }
  await browser.close(); bridge.kill(); fs.rmSync(temp, { recursive: true, force: true });
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); bridge && bridge.kill(); process.exit(1); });
