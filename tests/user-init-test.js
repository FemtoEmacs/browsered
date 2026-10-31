// user-init-test.js -- the user's own folder in the browser, ~/.browsered:
// made at the first start with an init.scm (an older ~/.schememax is moved
// there), found by TAB; saving a file in a folder that does not exist asks
// to make it ("y", as Emacs asks; "n" makes nothing); the files are loaded
// when the page starts again, and a key bound there (C-^, typed Ctrl-6)
// runs (make check-web).
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), http = require("http");
const server = http.createServer((q, r) => { r.writeHead(200, {"content-type": "text/html"});
  r.end(fs.readFileSync(path.resolve(__dirname, "..", "Browsered.html"))); });
let failed = 0;
function check(name, ok, detail) { console.log((ok ? "ok    " : "FAIL  ") + name + (ok ? "" : "  " + (detail || ""))); if (!ok) failed++; }
(async () => {
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL ? { channel: process.env.BROWSERED_TEST_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const scheme = async expr => {
    await page.evaluate(() => Module.browsered._test = null);
    await page.keyboard.press("Escape"); await page.keyboard.press(":");
    await page.keyboard.insertText("(web-request \"test-result\" (with-output-to-string (lambda () (write " + expr + "))))");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Module.browsered._test !== null);
    return page.evaluate(() => Module.browsered._test);
  };
  const exists = f => page.evaluate(f => { try { FS.stat(f); return true; } catch (e) { return false; } }, f);
  const lastLine = () => page.evaluate(() => Module.browsered._screen.lines[Module.browsered._screen.rows - 1]);
  const modeRows = () => page.evaluate(() => Module.browsered._screen.lines
    .map((l, i) => /\*scratch\*, L\. \d+/.test(l) ? i : -1).filter(i => i >= 0));
  const url = "http://127.0.0.1:" + server.address().port + "/?advanced";
  const start = async () => {
    await page.goto(url); await page.waitForTimeout(3000);
    await page.evaluate(() => { const paint = Module.browsered.paint;
      Module.browsered.paint = function (ptr, rows, cols, crow, ccol, ...rest) {
        const h = HEAP32.subarray(ptr >> 2, (ptr >> 2) + rows * cols * 4), lines = [];
        for (let y = 0; y < rows; y++) { let l = ""; for (let x = 0; x < cols; x++) l += String.fromCodePoint(h[(y * cols + x) * 4] || 32); lines.push(l.trimEnd()); }
        Module.browsered._screen = { lines, rows };
        return paint.call(this, ptr, rows, cols, crow, ccol, ...rest); }; });
  };
  // an older Browsered kept the user's files (the API keys) in ~/.schememax
  await page.goto(url); await page.waitForTimeout(3000);
  await page.evaluate(() => { FS.unlink("/home/web_user/.browsered/init.scm"); FS.rmdir("/home/web_user/.browsered");
    FS.mkdirTree("/home/web_user/.schememax"); FS.writeFile("/home/web_user/.schememax/anthropic-api-key", "k\n");
    return new Promise(ok => FS.syncfs(false, ok)); });
  await start();
  check("an older ~/.schememax is moved to ~/.browsered", await exists("/home/web_user/.browsered/anthropic-api-key") &&
        !(await exists("/home/web_user/.schememax")));
  check("~/.browsered/init.scm is made at the first start", await exists("/home/web_user/.browsered/init.scm"));
  // C-x C-f ~/.br TAB finds it
  for (const k of ["Control+x", "Control+f", "Control+u"]) await page.keyboard.press(k);
  await page.keyboard.insertText("~/.br"); await page.keyboard.press("Tab"); await page.waitForTimeout(600);
  const typed = await lastLine();
  check("C-x C-f ~/.br TAB completes the folder", /~\/\.browsered\/$/.test(typed), typed);
  await page.keyboard.press("Control+g"); await page.keyboard.press("Control+g"); await page.waitForTimeout(300);
  // a file in a folder that does not exist yet: asked, "n" makes nothing, "y" makes it
  for (const k of ["Control+x", "Control+f", "Control+u"]) await page.keyboard.press(k);
  await page.keyboard.insertText("~/.browsered/extensions/keys.scm"); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  await page.keyboard.insertText('(defcommand (enlarge-window-command) (execute-builtin "enlarge-window"))'); await page.keyboard.press("Enter");
  await page.keyboard.insertText('(global-set-key "C-^" \'enlarge-window-command)'); await page.keyboard.press("Enter");
  await page.keyboard.press("Control+x"); await page.keyboard.press("Control+s"); await page.waitForTimeout(600);
  const asked = await lastLine();
  check("C-x C-s asks to make the missing folder", /\/\.browsered\/extensions does not exist; create it \(y\/n\) \? n$/.test(asked), asked);
  await page.keyboard.press("n"); await page.waitForTimeout(600);
  check("\"n\": no folder, no file", !(await exists("/home/web_user/.browsered/extensions")));
  await page.keyboard.press("Control+x"); await page.keyboard.press("Control+s"); await page.waitForTimeout(600);
  await page.keyboard.press("y"); await page.waitForTimeout(1200);
  check("\"y\": the folder and the file are made", await exists("/home/web_user/.browsered/extensions/keys.scm"));
  await page.waitForTimeout(1000);                       // to IndexedDB
  await start();
  check("~/.browsered is loaded when the page starts again", await scheme("(key-binding \"C-^\")") === "enlarge-window-command");
  check("no script errors", await scheme("*script-errors*") === "()");
  check("the API keys are read from ~/.browsered", await scheme("(key-file-line \"anthropic-api-key\")") === "\"k\"");
  await page.keyboard.press("Control+x"); await page.keyboard.press("2"); await page.waitForTimeout(400);
  const before = await modeRows();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Control+6"); await page.waitForTimeout(150); }
  await page.waitForTimeout(400);
  const after = await modeRows();
  check("Ctrl-6 (C-^) enlarges the window", before.length === 2 && after.length === 2 && after[0] === before[0] + 3,
        JSON.stringify([before, after]));
  check("no errors in the page", errors.length === 0, errors.join("; "));
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})();
