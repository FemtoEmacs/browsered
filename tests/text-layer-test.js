// text-layer-test.js -- the text Grammarly sees: prose in the editor itself
// (all its keys and windows), with a transparent text field holding the
// window's text exactly over its rows (src/web-layer.c, textLayer in
// browsered.js, web-layer-edit in web.scm).  Grammarly is played by the
// test: it changes the field without a key (make check-web).
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), http = require("http");
const server = http.createServer((q, r) => { r.writeHead(200, {"content-type": "text/html"});
  r.end(fs.readFileSync(path.resolve(__dirname, "..", "Browsered.html"))); });
let failed = 0;
function check(name, ok, detail) { console.log((ok ? "ok    " : "FAIL  ") + name + (ok ? "" : "  " + (detail || ""))); if (!ok) failed++; }
(async () => {
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL ? { channel: process.env.BROWSERED_TEST_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const scheme = async expr => {
    await page.evaluate(() => Module.browsered._test = null);
    await page.keyboard.press("Escape"); await page.keyboard.press(":");
    await page.keyboard.insertText("(web-request \"test-result\" (with-output-to-string (lambda () (write " + expr + "))))");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Module.browsered._test !== null);
    await page.waitForTimeout(150);
    return page.evaluate(() => Module.browsered._test);
  };
  const findFile = async name => {
    await page.keyboard.press("Control+x"); await page.keyboard.press("Control+f"); await page.keyboard.press("Control+u");
    await page.keyboard.insertText(name); await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
  };
  const layer = page.locator("#text-layer");
  const text = async () => JSON.parse((await scheme("(buffer-substring 0 (buffer-size))")).replace(/\t/g, "\\t"));
  // Grammarly: a change of the field that no key made
  const grammarly = (from, to) => page.evaluate(([a, b]) => {
    const t = document.getElementById("text-layer"), i = t.value.indexOf(a);
    t.value = t.value.slice(0, i) + b + t.value.slice(i + a.length);
    t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  }, [from, to]);
  await page.goto("http://127.0.0.1:" + server.address().port + "/");
  await page.waitForTimeout(2500);

  const para = "Teh quick brown fox jumps over the lazy dog, and then it runs far away into the woods, where nobody can see it any more; it is a very long sentence that wraps over several rows. ";
  const body = "# Notes\n\n" + para + para + "\n\nA second paragraph abuot dogs — and cats, café.\n\tTabbed line.\n";
  await page.evaluate(b => FS.writeFile("/home/web_user/notes.md", b), body);
  await page.evaluate(() => FS.writeFile("/home/web_user/prog.scm", "(define (f x) x)\n"));
  await findFile("~/notes.md");
  check("a .md file opens in the editor itself", await page.locator("#writing-mode").count() === 0 && await scheme("(get-buffer-name)") === '"notes.md"');
  check("with no text field: Grammarly does not nag", await layer.count() === 0);
  check("the mode line has [GRAMMAR]", /GRAMMAR/.test(await scheme("(map car (mode-line-buttons (get-buffer-name)))")));
  await page.keyboard.press("Control+c"); await page.keyboard.press("d"); await page.waitForTimeout(400);
  check("C-c d ([GRAMMAR]) lays the text field over the window", await layer.count() === 1);
  check("holding the window's text", await layer.inputValue() === body, JSON.stringify(await layer.inputValue()));
  check("which has the keys", await page.evaluate(() => document.activeElement.id === "text-layer"));
  check("its letters are not painted, yet it does not look hidden", await page.evaluate(() => { const c = getComputedStyle(document.getElementById("text-layer")); return c.webkitTextFillColor === "rgba(0, 0, 0, 0)" && c.color !== "rgba(0, 0, 0, 0)" && !document.getElementById("text-layer").hasAttribute("autocomplete") && !document.getElementById("text-layer").hasAttribute("data-gramm"); }));
  check("M-x grammarly-status answers", /field: (not taken|data-)/.test(await page.evaluate(() => Module.browsered.call ? "" : "") + JSON.parse(await scheme("(web-request \"grammarly-status\")"))));

  // the field's rows are the editor's rows: every row starts where the
  // editor's does (markdown-wrap-end at the editor's width)
  const cols = await page.evaluate(() => Module.browsered.cols());
  const rows = [];
  for (let rest = Buffer.from(para + para); rest.length > 0; ) {
    const n = Number(await scheme(`(markdown-wrap-end ${JSON.stringify(rest.toString())} ${cols})`));
    rows.push(rest.subarray(0, n).toString()); rest = rest.subarray(n);
  }
  const layerRows = await page.evaluate(() => {
    const t = document.getElementById("text-layer"), cs = getComputedStyle(t), d = document.createElement("div");
    for (const k of ["font", "lineHeight", "letterSpacing", "whiteSpace", "overflowWrap", "tabSize", "width", "fontKerning"]) d.style[k] = cs[k];
    d.style.position = "absolute"; d.style.visibility = "hidden"; document.body.appendChild(d);
    const s = t.value.split("\n")[2], spans = [];
    for (const ch of s) { const e = document.createElement("span"); e.textContent = ch; d.appendChild(e); spans.push(e); }
    const out = []; let top = null, cur = "";
    spans.forEach(e => { if (top !== null && e.offsetTop !== top) { out.push(cur); cur = ""; } top = e.offsetTop; cur += e.textContent; });
    out.push(cur); d.remove(); return out;
  });
  check("its rows break where the editor's do", rows.length > 2 && JSON.stringify(layerRows.map(r => r.trimEnd())) === JSON.stringify(rows.map(r => r.trimEnd())),
        JSON.stringify(rows) + "\n  " + JSON.stringify(layerRows));
  const box = await layer.boundingBox();
  check("over the window's rows", box && box.y < 10 && box.height > 300, JSON.stringify(box));

  // typing goes to the editor, as always
  await scheme("(goto-char 0)");
  await page.keyboard.type("Hi ");
  await page.waitForTimeout(300);
  check("typing goes to the buffer", (await text()).startsWith("Hi # Notes"));
  check("and the field follows", (await layer.inputValue()).startsWith("Hi # Notes"));
  await page.keyboard.press("Control+/"); await page.waitForTimeout(300);
  check("C-/ undoes typing", (await text()) === body, JSON.stringify((await text()).slice(0, 20)));

  // Grammarly's corrections: one change each, the cursor where it was
  await scheme("(goto-char 200)");
  await grammarly("Teh quick", "The quick");
  await page.waitForTimeout(400);
  check("a correction in the field changes the buffer", (await text()).startsWith("# Notes\n\nThe quick"));
  check("the cursor stays", await scheme("(point)") === "200", await scheme("(point)"));
  await grammarly("abuot", "about");
  await grammarly("café.", "café!");
  await page.waitForTimeout(400);
  check("two corrections in a row, with Unicode", /about dogs — and cats, café!/.test(await text()), JSON.stringify(await text()));
  check("nothing was saved", (await page.evaluate(() => FS.readFile("/home/web_user/notes.md", { encoding: "utf8" }))) === body);
  await page.keyboard.press("Control+/"); await page.waitForTimeout(300);
  check("C-/ undoes the last correction", /cats, café\./.test(await text()) && /about/.test(await text()), JSON.stringify(await text()));
  // Grammarly adding a comma (no text removed), away from the cursor
  await grammarly("brown fox", "brown, fox");
  await page.waitForTimeout(400);
  check("an added comma is a correction too", /The quick brown, fox/.test(await text()) && await scheme("(point)") === "201", await scheme("(point)"));
  // a dead key (é): composed in the field, typed into the editor
  await scheme("(goto-char 0)");
  await page.evaluate(() => {
    const t = document.getElementById("text-layer");
    t.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    t.value = "é" + t.value; t.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }));
    t.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "é" }));
  });
  await page.waitForTimeout(400);
  check("a composed accent is typed at the cursor", (await text()).startsWith("é# Notes"), JSON.stringify((await text()).slice(0, 12)));
  await page.keyboard.press("Control+/"); await page.waitForTimeout(300);
  // a correction of text the buffer no longer holds is refused
  const before = await text();
  await scheme('(web-layer-edit "notes.md" 0 0 "not there" "x")');
  check("a stale correction changes nothing", await text() === before);

  // windows: C-x 2, the field over the selected window only
  await page.keyboard.press("Control+x"); await page.keyboard.press("2"); await page.waitForTimeout(400);
  check("C-x 2 splits the window", await scheme("(window-count)") === "2");
  const half = await layer.boundingBox();
  check("the field covers the selected window", half && half.height < box.height * 0.6, JSON.stringify(half));
  await page.keyboard.press("Control+x"); await page.keyboard.press("1"); await page.waitForTimeout(300);

  // [GRAMMAR] again: the check is done, the field goes away
  await page.keyboard.press("Control+c"); await page.keyboard.press("d"); await page.waitForTimeout(400);
  check("C-c d again ends the check: no field", await layer.count() === 0);
  check("and the keys are the editor's", await page.evaluate(() => document.activeElement.id === "keys"));
  // another buffer ends it too
  await page.keyboard.press("Control+c"); await page.keyboard.press("d"); await page.waitForTimeout(400);
  check("checking again", await layer.count() === 1);

  // programs: no field, Grammarly never sees code
  await findFile("~/prog.scm");
  check("another buffer ends the check", await layer.count() === 0);
  await page.keyboard.press("Control+c"); await page.keyboard.press("d"); await page.waitForTimeout(400);
  check("a program is never checked", await layer.count() === 0);
  check("its keys go to the editor as before", await page.evaluate(() => document.activeElement.id === "keys"));
  await page.keyboard.type(";x"); await page.waitForTimeout(300);
  check("typing in a program works", (await text()).startsWith(";x"));

  check("no errors in the page", errors.length === 0, errors.join("; "));
  await browser.close(); server.close();
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})();
