// web-test.js -- Browsered.html in a headless Chrome (make check-web).
// Development only: needs node and playwright (npm install playwright).
// Checks that the page starts, evaluates Scheme, reaches the page from
// Scheme (web-call), keeps HOME across a reload and asks Claude's API
// (answered here by a mock, no network).
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const page_file = path.join(__dirname, "..", "Browsered.html");
const codexBodies = [];
const server = http.createServer((q, r) => {
  if (q.url === "/codex" && q.method === "POST") {
    let body = "";
    q.on("data", b => { body += b; });
    q.on("end", () => {
      codexBodies.push(body);
      r.writeHead(200, {"content-type": "text/plain"}); r.end("MOCK-CODEX-ALLOWANCE");
    });
    return;
  }
  r.writeHead(200, { "content-type": "text/html" });
  r.end(fs.readFileSync(page_file));
});

let failed = 0;
function check(name, ok) { console.log((ok ? "ok    " : "FAIL  ") + name); if (!ok) failed++; }

(async () => {
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = process.env.WEB_TEST_FILE ? "file://" + page_file + "?standalone&advanced" : "http://127.0.0.1:" + server.address().port + "/?advanced";
  const browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL
    ? { channel: process.env.BROWSERED_TEST_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  const errors = [];
  let paidOpenAICalls = 0;
  await page.route("https://api.openai.com/**", r => { paidOpenAICalls++; return r.abort(); });
  page.on("pageerror", e => { errors.push(e.message); console.log("pageerror:", e.message); });
  page.on("console", m => { if (process.env.WEB_TEST_LOG) console.log("console:", m.text().slice(0, 300)); });
  await page.route("https://api.anthropic.com/**", r => r.fulfill({
    status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ type: "message", content: [{ type: "text", text: "MOCK-ANSWER" }] }) }));

  // the editor's text, read back through Scheme
  const scheme = async expr => {
    await page.evaluate(e => Module.browsered._test = null, null);
    await page.keyboard.press("Escape"); await page.keyboard.press(":");
    await page.keyboard.type("(web-request \"test-result\" (with-output-to-string (lambda () (write " + expr + "))))");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Module.browsered._test !== null);
    await page.waitForTimeout(150); // let Asyncify return to the key loop
    return page.evaluate(() => Module.browsered._test);
  };
  const keys = async (...ks) => { for (const k of ks) { await page.keyboard.press(k); if (ks[0] === "Control+x" && ["Control+f", "Control+w"].includes(k)) await page.keyboard.press("Control+u"); } };

  await page.goto(url);
  await page.waitForTimeout(2500);
  check("the page starts", errors.length === 0);
  check("Scheme evaluates", await scheme("(+ 20 22)") === "42");
  check("Scheme reaches the page", (await scheme("(web-request \"user-agent\")")).includes("Chrome"));
  check("the scripts are Schememax's", await scheme("(bound? 'ttfy)") === "#t" || await scheme("(bound? 'dired)") === "#t");

  // Test a real clipboard paste with dummy credentials only.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const dummyKey = "sk-proj-" + "test".repeat(50);
  const keyResult = scheme('(begin (set-openai-key) (key-file-line "openai-api-key"))');
  await page.waitForSelector("#api-key-input");
  check("API key uses a masked input", await page.locator("#api-key-input").getAttribute("type") === "password");
  await page.evaluate(text => navigator.clipboard.writeText(text), dummyKey);
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  await page.keyboard.press(mac ? "Meta+v" : "Control+v");
  await page.waitForTimeout(150);
  check("API key accepts clipboard paste", await page.locator("#api-key-input").inputValue() === dummyKey);
  await page.keyboard.press("Enter");
  check("API key is saved intact", await keyResult === JSON.stringify(dummyKey));
  const cancelled = scheme('(begin (set-openai-key) (key-file-line "openai-api-key"))');
  await page.waitForSelector("#api-key-input");
  await page.keyboard.press("Escape");
  check("cancel keeps the existing key", await cancelled === JSON.stringify(dummyKey));
  check("Codex uses the local allowance bridge",
        await scheme('(codex-cli-ask "subscription test" "source context")') === '"MOCK-CODEX-ALLOWANCE"');
  check("Codex sends the prompt and context, without the saved API key",
        codexBodies[0].includes("subscription test") && codexBodies[0].includes("source context") && !codexBodies[0].includes(dummyKey));
  check("browser Codex status describes subscription access",
        (await scheme('(codex-status-text)')).includes("Codex allowance"));

  // text typed with dead keys arrives composed, without its own keydown
  await keys("Control+x", "h", "Control+w");
  await page.keyboard.type("ab");
  await page.keyboard.insertText("~/ação");
  await page.waitForTimeout(300);
  check("dead keys and accents type (~/ação)",
        (await scheme("(buffer-substring 0 (buffer-size))")).includes("ab~/ação"));
  const beforeWriting = await scheme('(buffer-substring 0 (buffer-size))');
  const writingRound = scheme('(begin (writing-mode) #t)');
  await page.waitForSelector("#writing-text");
  check("Grammarly has a visible, spellchecked text field",
        await page.locator("#writing-text").isVisible() &&
        await page.locator("#writing-text").getAttribute("spellcheck") === "true" &&
        await page.locator("#writing-text").getAttribute("data-enable-grammarly") === "true");
  await page.locator("#writing-text").fill("Grammarly correction: café, ação.");
  await page.getByRole("button", {name: "Apply and return", exact: true}).click();
  await writingRound;
  await page.waitForTimeout(200);
  check("writing corrections return intact to the editor",
        await scheme('(buffer-substring 0 (buffer-size))') === JSON.stringify("Grammarly correction: café, ação."));
  await keys("Control+/");
  check("writing corrections can be undone", await scheme('(buffer-substring 0 (buffer-size))') === beforeWriting);
  const cancelWritingRound = scheme('(begin (writing-mode) #t)');
  await page.waitForSelector("#writing-text");
  await page.locator("#writing-text").fill("discard this draft");
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
  await cancelWritingRound;
  await page.waitForTimeout(200);
  check("cancel writing keeps the original buffer", await scheme('(buffer-substring 0 (buffer-size))') === beforeWriting);
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("~/");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "build/minibuffer.png" });
  await keys("Control+g");

  await page.keyboard.type("Texto salvo.");
  await keys("Control+x", "Control+w");
  await page.keyboard.type("/home/web_user/web-test.txt"); await keys("Enter");
  await page.waitForTimeout(1000);
  // an empty copy of a computer folder, as earlier Browsereds left in the
  // browser's storage: it must not survive the reload and hide the folder
  await page.evaluate(() => new Promise(ok => {
    FS.mkdir("/home/web_user/csand"); FS.mkdir("/home/web_user/csand/browsered");
    FS.writeFile("/home/web_user/csand/browsered/README.md", "");
    FS.syncfs(false, ok);
  }));
  await page.reload(); await page.waitForTimeout(2500);
  check("old copies of computer folders are dropped from the browser's storage",
        await page.evaluate(() => !FS.analyzePath("/home/web_user/csand").exists));
  check("HOME is kept across a reload",
        (await scheme("(file-contents \"/home/web_user/web-test.txt\")")).includes("Texto salvo."));

  await scheme("(begin (web-request \"mkdirs\" (config-file)) (call-with-output-file (config-file \"anthropic-api-key\") (lambda (p) (io.write p \"sk-test\"))))");
  check("Claude through the API", (await scheme("(claude-ask \"hi\" \"context\")")) === "\"MOCK-ANSWER\"");

  // a folder of the computer, played by a fake directory handle
  await page.evaluate(() => {
    window.written = {};
    const file = (name, text) => ({ kind: "file", name,
      getFile: async () => new File([text], name, { lastModified: 1 }),
      createWritable: async () => { let parts = []; return {
        write: async d => parts.push(d), close: async () => { window.written[name] = new TextDecoder().decode(parts[0]); } }; } });
    const dir = (name, entries) => ({ kind: "directory", name,
      values: async function* () { yield* entries; },
      getDirectoryHandle: async n => entries.find(e => e.name === n),
      getFileHandle: async n => entries.find(e => e.name === n) || file(n, "") });
    const csand = dir("csand", [dir("browsered", [file("README.md", "# Browsered\nhello\n"),
                                                  dir("sub", [file("deep.txt", "deep text")])]),
                                dir(".git", []), file("notes.txt", "notes")]);
    window.showDirectoryPicker = async () => csand;
  });
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("~/csa"); await keys("Tab");
  await page.waitForTimeout(800);       // the folder dialog (a fake here), then the completion
  await page.screenshot({ path: "build/tab.png" });
  await page.keyboard.insertText("brow"); await keys("Tab");
  await page.waitForTimeout(300);
  await page.keyboard.insertText("RE"); await keys("Tab", "Enter");
  await page.waitForTimeout(500);
  check("the folder is at ~/csand, without .git",
        !(await scheme("(directory-files \"/home/web_user/csand\")")).includes(".git"));
  check("C-x C-f ~/csa TAB asks for the folder, completes, and the file opens",
        (await scheme("(buffer-substring 0 (buffer-size))")).includes("hello"));
  check("listing and opening a folder write nothing to the computer",
        (await page.evaluate(() => Object.keys(window.written).length)) === 0);
  await page.keyboard.insertText("Saved. ");
  await keys("Control+x", "Control+s"); await page.waitForTimeout(500);
  check("a folder is writable by default on explicit save",
        ((await page.evaluate(() => window.written["README.md"])) || "").startsWith("Saved. # Browsered"));
  await scheme('(forbid-saving)');
  await page.keyboard.insertText("Protected. ");
  const protectedText = await page.evaluate(() => window.written["README.md"]);
  await keys("Control+x", "Control+s"); await page.waitForTimeout(500);
  check("forbid-saving blocks writes when protection is requested",
        (await page.evaluate(() => window.written["README.md"])) === protectedText);
  await page.keyboard.press("Escape"); await page.keyboard.press("x");
  await page.keyboard.type("allow-saving"); await keys("Enter");
  await page.waitForTimeout(300);
  await page.keyboard.type("y"); await keys("Enter");
  await page.waitForTimeout(300);
  await keys("Control+x", "Control+s"); await page.waitForTimeout(500);
  check("C-x C-s writes the file back to the computer",
        ((await page.evaluate(() => window.written["README.md"])) || "").startsWith("Saved. Protected. # Browsered"));
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("~/csand/browsered/sub/de"); await keys("Tab");
  await page.waitForTimeout(500); await keys("Enter"); await page.waitForTimeout(500);
  check("deeper folders complete too",
        (await scheme("(buffer-substring 0 (buffer-size))")).includes("deep text"));

  // a file changed on the computer after it was listed: its first reading
  // fails (as Chrome's does), and the page reads it again by itself
  await page.evaluate(() => {
    const send = XMLHttpRequest.prototype.send;
    window.failNext = true;
    XMLHttpRequest.prototype.send = function () {
      if (window.failNext) { window.failNext = false; throw new DOMException("stale", "NotReadableError"); }
      return send.apply(this, arguments);
    };
  });
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("~/csand/notes.txt"); await keys("Enter");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "build/stale.png" });
  check("a file changed on the computer is read again by itself",
        (await scheme("(buffer-substring 0 (buffer-size))")).includes("notes"));

  // RET straight away on a file of a folder not given yet
  await page.evaluate(() => {
    const f = { kind: "file", name: "x.txt", getFile: async () => new File(["lab notes\n"], "x.txt", { lastModified: 2 }) };
    const lab = { kind: "directory", name: "lab", values: async function* () { yield f; },
                  getDirectoryHandle: async () => null, getFileHandle: async () => f };
    window.showDirectoryPicker = async () => lab;
  });
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("~/lab/x.txt"); await keys("Enter");
  await page.waitForTimeout(1200);
  check("C-x C-f ~/lab/x.txt RET asks for the folder and reads the file",
        (await scheme("(buffer-substring 0 (buffer-size))")).includes("lab notes"));

  // a real folder on disk (the browser's private one, over http only),
  // changed after it was listed
  if (!process.env.WEB_TEST_FILE) {
    await page.evaluate(async () => {
      const opfs = await navigator.storage.getDirectory();
      const papers = await opfs.getDirectoryHandle("papers", { create: true });
      const h = await papers.getFileHandle("draft.md", { create: true });
      let w = await h.createWritable(); await w.write("first draft\n"); await w.close();
      window.showDirectoryPicker = async () => papers;
      window.draftHandle = h;
    });
    await keys("Control+x", "Control+f");
    await page.keyboard.insertText("~/pap"); await keys("Tab");
    await page.waitForTimeout(800);
    await page.evaluate(async () => {
      const w = await window.draftHandle.createWritable(); await w.write("second draft\n"); await w.close();
    });
    await page.keyboard.insertText("dr"); await keys("Tab", "Enter");
    await page.waitForTimeout(800);
    const text = await scheme("(buffer-substring 0 (buffer-size))");
    check("a real folder on disk opens (" + text.trim() + ")", text.includes("draft"));
  }

  // TTFY: a two-page PDF rendered by pdf.js, sent to a mock Claude
  let ttfyImages = -1;
  await page.unroute("https://api.anthropic.com/**");
  await page.route("https://api.anthropic.com/**", r => {
    const body = JSON.parse(r.request().postData());
    const content = body.messages[0].content;
    if (Array.isArray(content)) ttfyImages = content.filter(c => c.type === "image").length;
    return r.fulfill({ status: 200, contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "message", content: [{ type: "text",
        text: Array.isArray(content) ? "# Paper\n\nPage 1 and page 2 TEXTIFIED." : "MOCK-ANSWER" }] }) });
  });
  await page.evaluate(() => {
    const pdf = (function () {
      const objs = [], pages = [1, 2];
      const add = s => { objs.push(s); return objs.length; };
      add("<< /Type /Catalog /Pages 2 0 R >>");
      add("<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>");
      pages.forEach((n, i) => {
        add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents " + (4 + 2 * i) +
            " 0 R /Resources << /Font << /F1 7 0 R >> >> >>");
        const text = "BT /F1 24 Tf 40 100 Td (Page " + n + ") Tj ET";
        add("<< /Length " + text.length + " >>\nstream\n" + text + "\nendstream");
      });
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
      let out = "%PDF-1.4\n", offsets = [];
      objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
      const xref = out.length;
      out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" +
             offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") +
             "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
      return out;
    })();
    FS.writeFile("/home/web_user/paper.pdf", pdf);
  });
  await scheme("(begin (set! ttfy-read-guidelines (lambda () \"rules\")) #t)");
  const ttfy = await scheme("(trycatch (ttfy-request \"claude\" \"/home/web_user/paper.pdf\" \"\" \"rules\") (lambda (e) (list (quote error) e)))");
  console.log("ttfy answer:", ttfy);
  check("TTFY renders the PDF's pages with pdf.js and sends them (" + ttfyImages + " images)",
        ttfyImages === 2 && (ttfy || "").includes("TEXTIFIED"));
  check("Codex PDF textification uses the local bridge",
        await scheme('(ttfy-request "codex" "/home/web_user/paper.pdf" "" "rules")') === '"MOCK-CODEX-ALLOWANCE"');
  check("Codex receives both rendered PDF pages", /^\n2\n/.test(codexBodies[codexBodies.length - 1]));

  // the whole of C-c f: menu, PDF prompt, pages, new buffer
  await keys("Control+c", "f"); await page.waitForTimeout(400);
  await page.keyboard.type("2"); await page.waitForTimeout(400);
  await keys("Control+u");
  await page.keyboard.insertText("/home/web_user/paper.pdf"); await keys("Enter");
  await page.waitForTimeout(400);
  await keys("Enter");                                   // pages: all
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "build/ttfy.png" });
  check("C-c f textifies a PDF into a new buffer",
        (await scheme("(buffer-substring 0 (buffer-size))")).includes("TEXTIFIED"));

  // C-c p: irene-dixe's window, irene-dixe.c compiled to WebAssembly
  await page.evaluate(() => FS.writeFile("/home/web_user/km.md",
    "(estimator-plot :title \"Survival\"\n  :axes (:x (:label \"Months\" :limits (0 12)) :y (:unit proportion :limits (0 1)))\n" +
    "  :cohorts ((:id a :label \"Arm A\" :style (:color \"red\")))\n" +
    "  :curves ((:cohort a :steps ((:kind :start :time 0 :survival 1.0) (:kind :drop :time 2 :from 1.0 :to 0.9)\n" +
    "    (:kind :drop :time 5 :from 0.8 :to 0.75) (:kind :end :time 11 :survival 0.75))))\n" +
    "  :numbers-at-risk (:times (0 6 12) :rows ((:cohort a :counts (20 12 5)))))\n"));
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("/home/web_user/km.md"); await keys("Enter");
  await page.waitForTimeout(400);
  await keys("ArrowDown", "ArrowDown");
  await keys("Control+c", "p"); await page.waitForTimeout(1500);
  await page.screenshot({ path: "build/irene.png" });
  check("C-c p opens irene-dixe's window", await page.evaluate(() => !!document.querySelector(".irene-dixe")));
  await page.keyboard.press("s"); await page.waitForTimeout(800);
  await page.keyboard.press("q"); await page.waitForTimeout(800);
  await page.screenshot({ path: "build/irene-after.png" });
  const png = await page.evaluate(() => {
    try { return FS.stat("/home/web_user/km-plot-1.png").size; } catch (e) { return 0; }
  });
  check("s saves the plot as a PNG beside the file (" + png + " bytes), q closes the window",
        png > 1000 && await page.evaluate(() => !document.querySelector(".irene-dixe")));

  await page.evaluate(() => {
    const d = FS.readFile("/home/web_user/km-plot-1.png");
    window.pngHead = Array.from(d.slice(1, 4)).map(c => String.fromCharCode(c)).join("");
  });
  check("the picture is a PNG", (await page.evaluate(() => window.pngHead)) === "PNG");
  // M-x plot-save: irene-dixe --render, waited for (run-program)
  await page.keyboard.press("Escape"); await page.keyboard.press("x");
  await page.keyboard.type("plot-save"); await keys("Enter");
  await page.waitForTimeout(1500);
  const png2 = await page.evaluate(() => { try { return FS.stat("/home/web_user/km-plot-2.png").size; } catch (e) { return 0; } });
  check("M-x plot-save writes the picture without a window (" + png2 + " bytes)", png2 > 1000);
  if (process.env.WEB_TEST_DUMP) {
    console.log(await page.evaluate(() => JSON.stringify(FS.readdir("/home/web_user").map(n => {
      try { const st = FS.stat("/home/web_user/" + n); return n + ":" + (FS.isDir(st.mode) ? "dir" : "file") + ":" + st.size; } catch (e) { return n + ":?"; }
    }))));
    const dump = await page.evaluate(() => [1, 2].map(n => {
      const d = FS.readFile("/home/web_user/km-plot-" + n + ".png"); let s = "";
      for (let i = 0; i < d.length; i++) s += String.fromCharCode(d[i]);
      return btoa(s);
    }));
    require("fs").writeFileSync("build/km-plot-1.png", Buffer.from(dump[0], "base64"));
    require("fs").writeFileSync("build/km-plot-2.png", Buffer.from(dump[1], "base64"));
  }

  // C-c p on a (data-table ...): irene-dixe shows the table
  await page.evaluate(() => FS.writeFile("/home/web_user/table.md",
    "(data-table :schema schememax/data-table/1 :table \"1\" :caption \"Cohort\"\n" +
    "  :provenance (:source \"p.pdf\" :pdf-page 3) :basis :printed :stub \"Characteristic\"\n" +
    "  :columns ((:id c1 :label \"A, No. (%)\") (:id c2 :label \"p\"))\n" +
    "  :rows ((:label \"Stage\" :cells (nil (:< 0.001))\n" +
    "          :rows ((:label \"Local\" :cells ((:count 18053 :percent 82.3) nil))))\n" +
    "         (:label \"Median\" :cells ((:value 33.0 :ci (141 :na)) \"—\")))\n" +
    "  :notes (\"NA, not reached.\") :abbreviations nil)\n"));
  await keys("Control+x", "Control+f");
  await page.keyboard.insertText("/home/web_user/table.md"); await keys("Enter");
  await page.waitForTimeout(400);
  await keys("ArrowDown", "ArrowDown");
  await keys("Control+c", "p"); await page.waitForTimeout(1500);
  await page.screenshot({ path: "build/irene-table.png" });
  check("C-c p shows a data-table in irene-dixe's window",
        await page.evaluate(() => !!document.querySelector(".irene-dixe")));
  await page.keyboard.press("q"); await page.waitForTimeout(500);

  await keys("Control+h"); await page.waitForTimeout(500);
  check("C-h opens the keys page", (await scheme("(get-buffer-name)")).includes("help"));
  // Closing a user-opened tab can be denied, but the editor must exit.
  await page.evaluate(() => { window.close = function () {}; });
  await keys("Control+x", "Control+c");
  await page.waitForTimeout(150);
  if (!(await page.locator("#editor-closed").count())) await page.keyboard.press("y");
  await page.waitForSelector("#editor-closed");
  check("C-x C-c exits to the closed screen", !(await page.locator("#screen").isVisible()));
  await page.keyboard.press("a");
  await page.locator("#editor-closed h1").click();
  await page.waitForTimeout(250);
  check("ordinary input does not restart the editor", await page.locator("#editor-closed").isVisible());
  await page.screenshot({ path: "build/closed.png" });
  await page.getByRole("button", { name: "Restart Browsered" }).click();
  await page.waitForTimeout(2500);
  check("explicit restart opens the editor", await scheme("(+ 20 22)") === "42");
  check("no errors in the page", errors.length === 0);
  check("no paid OpenAI API calls", paidOpenAICalls === 0);
  if (errors.length) console.log(errors.join("\n"));

  await browser.close();
  server.close();
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})();
