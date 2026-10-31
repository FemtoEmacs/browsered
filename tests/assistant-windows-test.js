// assistant-windows-test.js -- tool windows leave the others alone: with
// two windows, Hints, Question and Discussion (Claude C-c r and Codex C-c g)
// and the shell (C-x @, M-!) open a window below the file they were called
// from, and [CLOSE], C-c q, C-c y (and C-x 1 in the shell) give back exactly
// the windows there were (buffers and rows), the caller's selected.
// Mock providers only (make check-web).
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),assert=require('assert/strict');
const ANSWER='MOCK-ANSWER\n\n```scheme\n(+ 1 2)\n```\n';
(async()=>{
 let browser;
 const server=http.createServer((q,r)=>{if(q.url==='/codex'){q.resume();q.on('end',()=>{r.writeHead(200);r.end(ANSWER);});return;}r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
 const page=await browser.newPage({viewport:{width:800,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://api.openai.com/**',r=>{throw Error('Unexpected paid API request');});
 await page.route('https://api.anthropic.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:[{type:'text',text:ANSWER}]})}));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(1800);
 const keys=async(...ks)=>{for(const k of ks)await page.keyboard.press(k);};
 const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.insertText('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(80);return page.evaluate(()=>Module.browsered._test);};
 // the windows from the selected one on: (buffer rows) each
 await page.evaluate(()=>{FS.writeFile('/home/web_user/layout.scm','(define (layout) (let loop ((k 0) (acc (quote ()))) (if (= k (window-count)) (reverse acc) (let ((w (list (get-buffer-name) (window-rows)))) (other-window) (loop (+ k 1) (cons w acc))))))\n');
   FS.writeFile('/home/web_user/a.scm','(define (fib n)\n  (if (< n 2) 1\n');FS.writeFile('/home/web_user/b.scm','(display "other")\n');});
 await scheme('(load "/home/web_user/layout.scm")');
 await scheme('(begin (web-request "mkdirs" (config-file)) (call-with-output-file (config-file "anthropic-api-key") (lambda (p) (io.write p "test-key"))))');
 const open=async f=>{await keys('Control+x','Control+f','Control+u');await page.keyboard.insertText(f);await keys('Enter');await page.waitForTimeout(500);};
 await open('~/a.scm');await keys('Control+x','2');await keys('Control+x','o');await open('~/b.scm');await keys('Control+x','o');
 const before=await scheme('(layout)');
 assert.match(before,/^\(\("a\.scm" \d+\) \("b\.scm" \d+\)\)$/);
 const same=async what=>{const now=await scheme('(layout)');assert.equal(now,before,what+': '+now+' instead of '+before);};
 const three=async what=>{assert.equal(await scheme('(window-count)'),'3',what+': the assistant has a window of its own');};
 let n=0;
 for(const key of ['r','g']){
  // Hints, closed by C-c q
  await keys('Control+c',key);await page.waitForTimeout(300);await keys('h');await page.waitForTimeout(1200);
  await three(key+' hints');assert.equal(await scheme('(get-buffer-name)'),'"a.scm"');
  await keys('Control+c','q');await page.waitForTimeout(300);await same(key+' hints, C-c q');n++;
  // Hints, closed by [CLOSE] (its command) from the answer window
  await keys('Control+c',key);await page.waitForTimeout(300);await keys('h');await page.waitForTimeout(1200);
  await scheme('(select-window-showing *assistant-buffer*)');await keys('Escape','x');await page.keyboard.insertText('close-assistant-windows');await keys('Enter');await page.waitForTimeout(300);
  await same(key+' hints, [CLOSE]');n++;
  // a question: the answer takes the question's window; C-c y inserts and closes
  await keys('Control+c',key);await page.waitForTimeout(300);await keys('q');await page.waitForTimeout(300);
  await three(key+' question');
  await page.keyboard.insertText('Finish fib.');await keys('Control+c',key);await page.waitForTimeout(1200);
  await three(key+' answer');
  await keys('Control+c','y');await page.waitForTimeout(300);await page.keyboard.insertText('y');await keys('Enter');await page.waitForTimeout(500);
  await same(key+' question, C-c y');n++;
  // a discussion, closed by C-c q from inside it
  await keys('Control+c',key);await page.waitForTimeout(300);await keys('d');await page.waitForTimeout(400);
  await three(key+' discussion');
  await page.keyboard.insertText('Why?');await keys('Control+c',key);await page.waitForTimeout(1200);
  await keys('Control+c','q');await page.waitForTimeout(300);await same(key+' discussion, C-c q');n++;
 }
 assert.ok((await scheme('(buffer-substring 0 (buffer-size))')).includes('(+ 1 2)'),'C-c y put the code in a.scm');
 // the shell (C-x @ / M-!): its window below the caller; C-c q, [CLOSE] and C-x 1 there give the windows back
 const caller=async b=>assert.equal(await scheme('(get-buffer-name)'),JSON.stringify(b),'back in the window that called');
 await keys('Control+x','@');await page.waitForTimeout(400);await three('C-x @');
 await page.keyboard.insertText('pwd');await keys('Control+c','s');await page.waitForTimeout(800);
 await three('C-c s');assert.equal(await scheme('(get-buffer-name)'),'"*output*"');
 await keys('Control+c','q');await page.waitForTimeout(300);await same('shell, C-c q');await caller('a.scm');n++;
 await keys('Escape','!');await page.waitForTimeout(400);await three('M-!');
 await keys('Escape','x');await page.keyboard.insertText('shell-close');await keys('Enter');await page.waitForTimeout(300);await same('shell, [CLOSE]');await caller('a.scm');n++;
 await keys('Control+x','@');await page.waitForTimeout(400);await keys('Control+x','1');await page.waitForTimeout(300);await same('shell, C-x 1 in it');n++;
 // called from the lower window: back to it, the layout as before
 await keys('Control+x','o');const lower=await scheme('(layout)');
 await keys('Control+x','@');await page.waitForTimeout(400);await page.keyboard.insertText('pwd');await keys('Control+c','s');await page.waitForTimeout(800);
 await keys('Control+c','q');await page.waitForTimeout(300);assert.equal(await scheme('(layout)'),lower,'shell from the lower window');await caller('b.scm');n++;
 await keys('Control+x','o');
 // the help page: C-c q closes it too
 await keys('Control+h');await page.waitForTimeout(400);await keys('Control+c','q');await page.waitForTimeout(300);await same('help, C-c q');n++;
 assert.equal(await scheme('(key-binding "C-c q")'),'close-tool-window');
 assert.deepEqual(errors,[]);
 console.log('PASS tool windows: with two windows, Claude and Codex (hints, question with C-c y, discussion), the shell (C-x @, M-!: C-c q, [CLOSE], C-x 1) and help give back the same windows ('+n+' cases); C-c q is [CLOSE]');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
