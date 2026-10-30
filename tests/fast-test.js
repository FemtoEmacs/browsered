// fast-test.js -- src/web-fast.c gives exactly what the Scheme it replaces
// gives: latex-highlight (tex.scm) and markdown-wrap-end (markdown.scm),
// on the LaTeX manual cut at many places and on awkward bits of TeX; and
// typing in a LaTeX file stays fast (make check-web).
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
  const oneLine = s => s.replace(/\s*\n\s*/g, " ");
  const scheme = async expr => {
    await page.evaluate(() => Module.browsered._test = null);
    await page.keyboard.press("Escape"); await page.keyboard.press(":");
    await page.keyboard.insertText("(web-request \"test-result\" (with-output-to-string (lambda () (write " + expr + "))))");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Module.browsered._test !== null, null, { timeout: 120000 })
      .catch(async e => { await page.screenshot({ path: "build/fast-test-failure.png" }); throw e; });
    return page.evaluate(() => Module.browsered._test);
  };
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
  // the comparisons, defined once by loading a file (in Scheme, outside any window)
  await page.evaluate(src => FS.writeFile("/home/web_user/fast-compare.scm", src), `(define (fast-colors f text n) (let ((c (make-colors n))) (f (find-language "TeX") text n c) c))
    (define (fast-same-colors? text)
      (let ((n (length text)))
        (equal? (fast-colors *scheme-latex-highlight* text n) (fast-colors web-latex-highlight text n))))
    (define (fast-latex-cuts text step size)
      (do ((k 0 (+ k step)) (bad 0 (if (fast-same-colors? (byte-substring text k (min (length text) (+ k size)))) bad (+ bad 1))))
          ((>= k (length text)) bad)))
    (define (fast-wrap-cuts text step size)
      (do ((k 0 (+ k step))
           (bad 0 (+ bad (length (filter (lambda (cols) (let ((s (byte-substring text k (min (length text) (+ k size)))))
                                                          (not (= (*scheme-markdown-wrap-end* s cols) (web-wrap-end s cols)))))
                                         '(1 2 7 20 37 80 151))))))
          ((>= k (length text)) bad)))
    (define (fast-in-place?) (and (eq? markdown-wrap-end web-wrap-end) (eq? (language-highlighter (find-language "TeX")) web-latex-highlight)))
    (define (fast-sees-a-difference?) (not (equal? (fast-colors (lambda (l t n c) (aset! c 0 99)) "ab" 2) (fast-colors web-latex-highlight "ab" 2))))`);
  check("the comparisons load", await scheme('(begin (load "/home/web_user/fast-compare.scm") #t)') === "#t");
  const open = async name => {
    for (const k of ["Control+x", "Control+f", "Control+u"]) await page.keyboard.press(k);
    await page.keyboard.insertText(name); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  };
  await open("~/t.tex");
  check("awkward TeX: the same colours as tex.scm", await scheme("(fast-same-colors? (buffer-substring 0 (buffer-size)))") === "#t");
  check("awkward TeX cut at every byte: the same colours", await scheme("(fast-latex-cuts (buffer-substring 0 (buffer-size)) 1 400)") === "0");
  check("awkward TeX: the same rows as markdown.scm", await scheme("(fast-wrap-cuts (buffer-substring 0 (buffer-size)) 1 300)") === "0");
  await open("~/m.tex");
  check("the LaTeX manual: the same colours", await scheme("(fast-same-colors? (buffer-substring 0 (buffer-size)))") === "#t");
  check("the manual cut at 300 places: the same colours", await scheme("(fast-latex-cuts (buffer-substring 0 (buffer-size)) 293 4000)") === "0");
  check("the manual: the same rows at 7 widths", await scheme("(fast-wrap-cuts (buffer-substring 0 (buffer-size)) 97 700)") === "0");
  check("the C versions are in place", await scheme("(fast-in-place?)") === "#t");
  check("the comparison sees a difference", await scheme("(fast-sees-a-difference?)") === "#t");

  // typing in the middle of the manual: well under a frame per key
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
  check("no errors in the page", errors.length === 0, errors.join("; "));
  await browser.close(); server.close();
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})();
