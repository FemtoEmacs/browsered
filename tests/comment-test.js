// M-; (and TAB in Markdown ``` blocks) by real keystrokes, entirely in the disposable browser filesystem.
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 let browser;
 try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(1800);
 const keys=async(...ks)=>{for(const k of ks)await page.keyboard.press(k);};
 const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.insertText('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(80);return page.evaluate(()=>Module.browsered._test);};
 const setup=async(text,name='comment.scm')=>scheme('(begin (select-buffer "'+name+'") (erase-buffer) (deactivate-mark) (insert '+JSON.stringify(text)+') (goto-char 0))');
 const text=()=>scheme('(buffer-substring 0 (buffer-size))');
 await setup('(foo)');await keys('Escape',';');assert.equal(await text(),JSON.stringify('(foo)'+' '.repeat(27)+'; '));
 await page.keyboard.insertText('note');await keys('Escape',';');assert.equal(await text(),JSON.stringify('(foo)'+' '.repeat(27)+'; note'));
 await setup('(display ";")');await keys('Escape',';');assert.equal(await text(),JSON.stringify('(display ";")'+' '.repeat(19)+'; '));
 await setup('   ');await keys('Escape',';');assert.equal(await text(),JSON.stringify('   ;; '));
 await setup('  (one)\n  (two)\n');await keys('Control+x','h','Escape',';');assert.equal(await text(),JSON.stringify('  ;; (one)\n  ;; (two)\n'));
 await keys('Control+x','h','Escape',';');assert.equal(await text(),JSON.stringify('  (one)\n  (two)\n'));
 await setup('x = 1','comment.py');await keys('Escape',';');assert.equal(await text(),JSON.stringify('x = 1'+' '.repeat(27)+'# '));
 await setup('puts("//");','comment.c');await keys('Escape',';');assert.equal(await text(),JSON.stringify('puts("//");'+' '.repeat(21)+'// '));
 await setup('(foo) ; old');await keys('Escape',';');assert.equal(await text(),JSON.stringify('(foo)'+' '.repeat(27)+'; old'));assert.equal(await scheme('(point)'), '34');
 await setup('café','unicode.py');await keys('Escape',';');assert.equal(await text(),JSON.stringify('café'+' '.repeat(28)+'# '));
 await setup('(foo)');await scheme('(set-mark 0)');await keys('Escape',';');assert.equal(await text(),JSON.stringify('(foo)'+' '.repeat(27)+'; '));
 // Markdown: a ``` block follows its own language (M-;, region, TAB); prose has no comment syntax
 const md='Text.\n\n```scheme\n(foo)\n```\n';
 await setup(md,'notes.md');await scheme('(goto-char '+md.indexOf('(foo)')+')');await keys('Escape',';');
 assert.equal(await text(),JSON.stringify(md.replace('(foo)','(foo)'+' '.repeat(27)+'; ')));
 const two='```Scheme\n(a)\n(b)\n```\n';
 await setup(two,'notes.md');await scheme('(begin (set-mark '+two.indexOf('(a)')+') (goto-char '+(two.indexOf('(b)')+3)+'))');await keys('Escape',';');
 assert.equal(await text(),JSON.stringify('```Scheme\n;; (a)\n;; (b)\n```\n'));
 const py='```python\nx = 1\n```\n';
 await setup(py,'notes.md');await scheme('(goto-char '+py.indexOf('x')+')');await keys('Escape',';');
 assert.equal(await text(),JSON.stringify(py.replace('x = 1','x = 1'+' '.repeat(27)+'# ')));
 await setup(md,'notes.md');await keys('Escape',';');assert.equal(await text(),JSON.stringify(md));
 const fib='```Scheme\n(define (fib n)\n    (if (< n 2) 1\n\n```\n';
 await setup(fib,'notes.md');await scheme('(goto-char '+(fib.indexOf('1\n')+2)+')');await keys('Tab');
 assert.equal(await text(),JSON.stringify(fib.replace('1\n\n','1\n        \n')));
 assert.deepEqual(errors,[]);
 console.log('PASS real M-;: comments, alignment, strings, blank line, region toggle, Python/C, Unicode, empty region, Markdown ``` blocks (M-;, region, TAB)');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
