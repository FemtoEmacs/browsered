// Exercise real key-bound assistant menus with mock providers only.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),assert=require('assert/strict');
(async()=>{
 let calls=0,browser;
 const server=http.createServer((q,r)=>{if(q.url==='/codex'){calls++;q.resume();q.on('end',()=>{r.writeHead(200);r.end('MOCK-CODEX-RESULT');});return;}r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://api.openai.com/**',r=>{throw Error('Unexpected paid API request');});
 await page.route('https://api.anthropic.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({content:[{type:'text',text:'MOCK-CLAUDE-RESULT'}]})}));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(1800);
 const keys=async(...ks)=>{for(const k of ks)await page.keyboard.press(k);};
 const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.insertText('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(80);return page.evaluate(()=>Module.browsered._test);};
 await page.evaluate(()=>{window.compileFailures=[];const next=BrowseredSchemer.next;BrowseredSchemer.next=id=>next(id).then(s=>{if(s.startsWith('R\n')&&!JSON.parse(s.slice(2)).ok)compileFailures.push(JSON.parse(s.slice(2)));return s;});});
 await scheme('(begin (web-request "mkdirs" (config-file)) (call-with-output-file (config-file "anthropic-api-key") (lambda (p) (io.write p "test-key"))))');
 // Help and mode-line menu actions use separate wrappers with native callbacks.
 for(const [entry,answer,choice] of [['menu-chatgpt','MOCK-CODEX-RESULT','2'],['menu-claude','MOCK-CLAUDE-RESULT','3']]){
 await scheme('(begin (select-buffer "*other-context*") (insert "Other buffer context") (select-buffer "*menu-source*") (insert "Menu source café") (enter-normal-mode (quote read)))');
 await keys('Escape','x');await page.keyboard.insertText('help-menu');await keys('Enter');await page.waitForTimeout(300);await keys(choice);await page.waitForTimeout(400);
 await keys('h');await page.waitForTimeout(800);
 const menuResult=await scheme('(let ((origin (get-buffer-name))) (select-buffer *assistant-buffer*) (let ((text (buffer-substring 0 (buffer-size)))) (select-buffer origin) text))');
 assert.ok(menuResult.includes(answer),entry+': '+menuResult+' failures: '+JSON.stringify(await page.evaluate(()=>window.compileFailures)));
 await keys('Control+x','1');await scheme('(leave-normal-mode- "test")');
 }
 // Native menu callbacks may return opaque editor values. The key dispatcher
 // ignores them; they must not be serialized across a compiled RPC boundary.
 await scheme('(begin (set! codex-menu (let ((old codex-menu)) (lambda () (old) (lambda () #t)))) (set! claude-menu (let ((old claude-menu)) (lambda () (old) (lambda () #t)))))');
 for(const [key,answer] of [['g','MOCK-CODEX-RESULT'],['r','MOCK-CLAUDE-RESULT']]){
 await scheme('(begin (select-buffer "*source*") (erase-buffer) (insert "Original source café") (enter-normal-mode (quote read)))');
 await keys('Control+c',key);await page.waitForTimeout(800);await keys('h');await page.waitForTimeout(1000);
 const result=await scheme('(let ((origin (get-buffer-name))) (select-buffer *assistant-buffer*) (let ((text (buffer-substring 0 (buffer-size)))) (select-buffer origin) text))');
 assert.ok(result.includes(answer),'Real assistant menu must show mock provider answer');
 await keys('Control+x','1');
 // Compose a question, then invoke the same key again to send it.
 await keys('Control+c',key);await page.waitForTimeout(300);await keys('q');await page.waitForTimeout(300);
 await page.keyboard.insertText('Explain this source.');await keys('Control+c',key);await page.waitForTimeout(1000);
 const question=await scheme('(let ((origin (get-buffer-name))) (select-buffer *assistant-buffer*) (let ((text (buffer-substring 0 (buffer-size)))) (select-buffer origin) text))');
 assert.ok(question.includes(answer),question);await keys('Control+x','1');
 await scheme('(begin (select-buffer "*source*") (leave-normal-mode- "test"))');
 await keys('Control+c',key);await page.waitForTimeout(300);await keys('d');await page.waitForTimeout(400);
 await page.keyboard.insertText('A discussion question.');await keys('Control+c',key);await page.waitForTimeout(1000);
 const discussion=await scheme('(buffer-substring 0 (buffer-size))');
 assert.ok(discussion.includes(answer),discussion);await keys('Control+x','1');
 }
 assert.equal(calls,4);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.compileFailures),[]);
 const diagnostic=await scheme('(trycatch (schemer-eval-string '+JSON.stringify('(error "MOCK-COMPILER-FAILURE")')+') (lambda (e) (describe-error e)))');
 assert.ok(diagnostic.includes('MOCK-COMPILER-FAILURE')&&!diagnostic.includes('[object Object]'),diagnostic);
 // Host failures can be plain objects rather than Error instances.
 await page.evaluate(()=>{const original=window.schemerHost;window.schemerHost=function(...args){const host=original(...args);host.imports.host.math=()=>{throw {kind:'mock-host-failure'};};return host;};});
 const opaqueError=await scheme('(trycatch (schemer-eval-string "(sin 1)") (lambda (e) (describe-error e)))');
 assert.ok(opaqueError.includes('Compiled Scheme execution failed')&&!opaqueError.includes('[object Object]'),opaqueError);
 console.log('all assistant command tests passed: Hints, Question, Discussion, READ mode, opaque native callbacks, clear errors; mock providers only');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
