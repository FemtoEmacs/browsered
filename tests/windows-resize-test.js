// windows-resize-test.js -- C-x 2's windows survive the browser window
// changing size (src/web.c, web_relayout in web-layer.c): the core's own
// answer to a resize was a single window.  Scheme the page runs between
// keys (a Grammarly correction) no longer counts as a resize either
// (make check-web).
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
  const modeLines = () => page.evaluate(() => Module.browsered._screen.lines.filter(l => /, L\. \d+/.test(l)).length);
  const cursorOnText = () => page.evaluate(() => { const s = Module.browsered._screen;
    return s.crow < s.rows - 1 && !/, L\. \d+/.test(s.lines[s.crow]); });
  await page.goto("http://127.0.0.1:" + server.address().port + "/?advanced");
  await page.waitForTimeout(2500);
  // the screen as text, and the cursor's row
  await page.evaluate(() => { const paint = Module.browsered.paint;
    Module.browsered.paint = function (ptr, rows, cols, crow, ccol, ...rest) {
      const h = HEAP32.subarray(ptr >> 2, (ptr >> 2) + rows * cols * 4), lines = [];
      for (let y = 0; y < rows; y++) { let l = ""; for (let x = 0; x < cols; x++) l += String.fromCodePoint(h[(y * cols + x) * 4] || 32); lines.push(l.trimEnd()); }
      Module.browsered._screen = { lines, crow, rows };
      return paint.call(this, ptr, rows, cols, crow, ccol, ...rest); }; });
  await page.evaluate(t => FS.writeFile("/home/web_user/b.md", t),
    fs.readFileSync(path.resolve(__dirname, "..", "docs", "browsered.md"), "utf8"));
  for (const k of ["Control+x", "Control+f", "Control+u"]) await page.keyboard.press(k);
  await page.keyboard.insertText("~/b.md"); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  await page.keyboard.press("Control+x"); await page.keyboard.press("2"); await page.waitForTimeout(300);
  await page.keyboard.press("Control+x"); await page.keyboard.press("o");
  for (let i = 0; i < 5; i++) await page.keyboard.press("PageDown");
  await page.waitForTimeout(300);
  check("C-x 2: two windows", await scheme("(window-count)") === "2");
  for (const [w, h, what] of [[900, 900, "larger"], [600, 300, "much smaller"], [720, 600, "back"]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(800);
    check("browser window " + what + ": still two windows, two mode lines", await modeLines() === 2 && await scheme("(window-count)") === "2",
          String(await modeLines()));
    check("browser window " + what + ": the cursor on its text", await cursorOnText());
  }
  // Scheme from the page between keys (a Grammarly correction) keeps them
  await page.keyboard.press("Control+c"); await page.keyboard.press("d"); await page.waitForTimeout(400);
  await page.evaluate(() => { const t = document.getElementById("text-layer"), i = t.value.indexOf("the");
    t.value = t.value.slice(0, i) + "The" + t.value.slice(i + 3);
    t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" })); });
  await page.waitForTimeout(500);
  check("a correction from the page keeps the windows", await scheme("(window-count)") === "2");
  check("no errors in the page", errors.length === 0, errors.join("; "));
  await browser.close(); server.close();
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})();
