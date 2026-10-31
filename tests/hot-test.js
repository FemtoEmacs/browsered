// hot-test.js -- the editor's busiest procedures compiled by Schemer
// (web.scm's hot-of, src/web-hot.c): tex.scm's latex-highlight and
// markdown.scm's markdown-wrap-end, compiled from their own source the first
// time they are used, give exactly what the interpreted Scheme gives, on the
// LaTeX manual cut at many places and on awkward bits of TeX; a user's own
// highlighter is compiled too; and typing in a LaTeX file is fast
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const warnings = []; page.on("console", m => { if (/hot path/.test(m.text())) warnings.push(m.text()); });
  const scheme = async expr => {
    await page.evaluate(() => Module.browsered._test = null);
    await page.keyboard.press("Escape"); await page.keyboard.press(":");
    await page.keyboard.insertText("(web-request \"test-result\" (with-output-to-string (lambda () (write " + expr + "))))");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Module.browsered._test !== null, null, { timeout: 120000 })
      .catch(async e => { await page.screenshot({ path: "build/hot-test-failure.png" }); throw e; });
    return page.evaluate(() => Module.browsered._test);
  };
  const open = async name => {
    for (const k of ["Control+x", "Control+f", "Control+u"]) await page.keyboard.press(k);
    await page.keyboard.insertText(name); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  };
  const hotReady = async n => page.waitForFunction(n => JSON.parse(BrowseredSchemer.hotStatus()).filter(h => h.state !== "compiling").length >= n,
                                                  n, { timeout: 60000 }).then(() => true, () => false);
  await page.goto("http://127.0.0.1:" + server.address().port + "/?advanced");
  await page.waitForTimeout(2500);
  const tricky = String.raw`\begin{equation} x^2 \end{equation} \begin{align*}a&=b\\ c\end{align*}
\section*{Star} \subsection[short]{Long {nested} title} \emph{e} \textbf{b} \cite{k1,k2}
$x$ $$y$$ \[ z \] \( w \) $unclosed \begin{equation} never closed
% comment \emph{not}
\begin [opt]{equation} odd \end{equation} \\ \{ \% \ 12.5 & ^ _ ~ é ação 日本 \
\begin{itemize}\item one\end{itemize} \href{http://x}{text} \label{a:b} \foo@bar \section`;
  await page.evaluate(([a, b]) => { FS.writeFile("/home/web_user/m.tex", a); FS.writeFile("/home/web_user/t.tex", b); },
    [fs.readFileSync(path.resolve(__dirname, "..", "docs", "browsered.tex"), "utf8"), tricky]);
  // the comparisons, in a file, run interpreted (loaded)
  await page.evaluate(src => FS.writeFile("/home/web_user/hot-compare.scm", src), `
    (define (hot-tex) (language-highlighter (find-language "TeX")))
    (define (hot-colors-interpreted text n) (let ((c (make-colors n))) ((hot-tex) (find-language "TeX") text n c) c))
    (define (hot-colors-compiled text n)
      (let ((c (make-colors n)) (id (hot-of (hot-tex) 'highlight)))
        (if (and id (>= (web-hot-call id text n c) 0)) c #f)))
    (define (hot-same-array? a b n) (let loop ((i 0)) (or (= i n) (and (= (aref a i) (aref b i)) (loop (+ i 1))))))
    (define (hot-same-colors? text)
      (let* ((n (length text)) (b (hot-colors-compiled text n)))
        (and b (hot-same-array? (hot-colors-interpreted text n) b n))))
    (define (hot-latex-cuts text step size)
      (do ((k 0 (+ k step)) (bad 0 (if (hot-same-colors? (byte-substring text k (min (length text) (+ k size)))) bad (+ bad 1))))
          ((>= k (length text)) bad)))
    (define (hot-wrap-same? s cols)
      (let ((id (hot-of markdown-wrap-end 'wrap)))
        (and id (= (markdown-wrap-end s cols) (web-hot-call id s (length s) cols)))))
    (define (hot-wrap-cuts text step size)
      (do ((k 0 (+ k step))
           (bad 0 (+ bad (length (filter (lambda (cols) (not (hot-wrap-same? (byte-substring text k (min (length text) (+ k size))) cols)))
                                         '(1 2 7 20 37 80 151))))))
          ((>= k (length text)) bad)))
    (define (hot-compiled? p) (fixnum? (get *hot* p #f)))
    (define (hot-both-compiled?) (list (hot-compiled? (hot-tex)) (hot-compiled? markdown-wrap-end)))
    (define (hot-shout-colours)
      (let* ((t "hello! world!!") (c (make-colors 14)) (h (language-highlighter (find-language "Shout"))))
        (list (hot-compiled? h) (aref (hot-colors-of h t c) 5) (aref c 0))))
    (define (hot-colors-of h t c)
      (let ((id (hot-of h 'highlight))) (web-hot-call id t (length t) c) c))`);
  check("the comparisons load", await scheme('(begin (load "/home/web_user/hot-compare.scm") #t)') === "#t");
  await open("~/m.tex");
  check("the LaTeX colouring and the wrapping are compiled when first used", await hotReady(2),
        await page.evaluate(() => BrowseredSchemer.hotStatus()));
  check("both compiled", await scheme("(hot-both-compiled?)") === "(#t #t)",
        await page.evaluate(() => BrowseredSchemer.hotStatus()));
  check("the LaTeX manual: the same colours as tex.scm", await scheme("(hot-same-colors? (buffer-substring 0 (buffer-size)))") === "#t");
  check("the manual cut at 300 places: the same colours", await scheme("(hot-latex-cuts (buffer-substring 0 (buffer-size)) 293 4000)") === "0");
  check("the manual: the same rows as markdown.scm, at 7 widths", await scheme("(hot-wrap-cuts (buffer-substring 0 (buffer-size)) 97 700)") === "0");
  await open("~/t.tex");
  check("awkward TeX: the same colours", await scheme("(hot-same-colors? (buffer-substring 0 (buffer-size)))") === "#t");
  check("awkward TeX cut at every byte: the same colours", await scheme("(hot-latex-cuts (buffer-substring 0 (buffer-size)) 1 400)") === "0");
  check("awkward TeX: the same rows", await scheme("(hot-wrap-cuts (buffer-substring 0 (buffer-size)) 1 300)") === "0");

  // a user's own highlighter is compiled too, from its source
  await page.evaluate(() => {
    FS.mkdirTree("/home/web_user/.browsered/languages");
    FS.writeFile("/home/web_user/.browsered/languages/shout.scm",
      '(define (shout-highlight lang text len colors)\n' +
      '  (do ((i 0 (+ i 1))) ((= i len)) (aset! colors i (if (= (aref text i) 33) +keyword+ +alpha+))))\n' +
      '(define-language "Shout" \'extensions \'(".shout") \'highlighter shout-highlight)\n');
    FS.writeFile("/home/web_user/a.shout", "hello! world!!\n");
  });
  await page.keyboard.press("Control+x"); await page.keyboard.press("Control+r"); await page.waitForTimeout(1500);
  await open("~/a.shout");
  check("a user's highlighter, defined in ~/.browsered/languages, is compiled", await hotReady(3),
        await page.evaluate(() => BrowseredSchemer.hotStatus()));
  check("and colours as written, compiled", await scheme("(hot-shout-colours)") === "(#t 4 5)", await scheme("(hot-shout-colours)"));

  // M-x scheme-highlighting: the interpreted Scheme again, then compiled
  await page.keyboard.press("Escape"); await page.keyboard.press("x"); await page.keyboard.insertText("scheme-highlighting"); await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("M-x scheme-highlighting: interpreted", await scheme("*hot-enabled*") === "#f");
  await page.keyboard.press("Escape"); await page.keyboard.press("x"); await page.keyboard.insertText("scheme-highlighting"); await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("and compiled again", await scheme("*hot-enabled*") === "#t");

  // typing in the middle of the manual
  await open("~/m.tex");
  await page.evaluate(() => { const B = Module.browsered, orig = B.paint; window.__paints = 0; B.paint = function () { window.__paints++; return orig.apply(this, arguments); }; });
  await page.keyboard.press("Escape"); await page.keyboard.press("Shift+Comma");
  for (let i = 0; i < 30; i++) await page.keyboard.press("PageDown");
  await page.waitForTimeout(300);
  const ms = await page.evaluate(async () => { const k = document.getElementById("keys"), ts = [];
    for (let i = 0; i < 21; i++) { const n = window.__paints, t0 = performance.now(); k.value = "x";
      k.dispatchEvent(new InputEvent("input", { bubbles: true, data: "x" }));
      while (window.__paints === n) await new Promise(r => setTimeout(r, 0)); ts.push(performance.now() - t0); }
    return ts.sort((a, b) => a - b)[10]; });
  check("typing in LaTeX takes " + ms.toFixed(1) + " ms a key (under 30)", ms < 30);
  check("no hot path failed", warnings.length === 0, warnings.join("; "));
  check("no errors in the page", errors.length === 0, errors.join("; "));
  await browser.close(); server.close();
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})();
