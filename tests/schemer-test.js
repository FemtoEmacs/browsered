const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),assert=require('assert/strict');
(async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 let browser;
 try {
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message);});page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log(m.text().slice(0,400));});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(2000);
  const keys=async(...ks)=>{for(const k of ks)await page.keyboard.press(k);};
  const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.insertText('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null,null,{timeout:60000});await page.waitForTimeout(100);return page.evaluate(()=>Module.browsered._test);};
  const compiled=code=>scheme('(schemer-eval-string '+JSON.stringify(code)+')');
  assert.equal(await compiled('(define (fib n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2))))) (fib 30)'),'832040');
  console.log('ok compiled Fibonacci');
  // Reproduce C-x C-e after a definition with trailing whitespace, then time it.
  await scheme('(begin (define *test-eval-message* (quote ())) (set! message (let ((old message)) (lambda args (set! *test-eval-message* args) (apply old args)))))');
  await scheme('(begin (select-buffer "*key-eval*") (erase-buffer))');
  await page.keyboard.insertText('(define (key-fib n)\n  (if (< n 2) n\n      (+ (key-fib (- n 1)) (key-fib (- n 2))))) ');
  await keys('Control+x','Control+e');await page.waitForTimeout(700);
  assert.equal(await scheme('(bound? (quote key-fib))'),'#t','C-x C-e must evaluate the preceding definition');
  assert.equal(await compiled('(key-fib 10)'),'55');
  await page.keyboard.insertText('\n\n(time (key-fib 40))');
  await keys('Control+x','Control+e');await page.waitForTimeout(1700);
  // Reading the captured message must not itself replace it.
  const timed=await scheme('*test-eval-message*');
  assert.ok(timed.includes('Elapsed time:') && timed.includes('102334155'),timed);
  console.log('ok actual C-x C-e definition and timed Fibonacci');
  await scheme('(begin (select-buffer "*defun-eval*") (erase-buffer))');
  await page.keyboard.insertText('(define (key-defun x) (+ x 7))');
  await keys('Control+Alt+x');await page.waitForTimeout(600);
  assert.equal(await scheme('(bound? (quote key-defun))'),'#t','C-M-x must retain its native scanning callback');
  assert.equal(await compiled('(key-defun 5)'),'12');
  assert.equal(await compiled('(list (length (quote (1 2 3))) (string-length "café"))'),'(3 4)');
  console.log('ok C-M-x and R7RS length semantics');
  await scheme('(begin (select-buffer "*motion.md*") (erase-buffer) (insert "a,b;c") (goto-char 0))');
  for(const expected of [1,2,3,4,5]){
    await keys('Control+Alt+f');assert.equal(await scheme('(point)'),String(expected));
  }
  for(const expected of [4,3,2,1,0]){
    await keys('Control+Alt+b');assert.equal(await scheme('(point)'),String(expected));
  }
  console.log('ok real C-M-f/C-M-b cross commas and semicolons');



  await scheme('(begin (select-buffer "*compiled*") (erase-buffer))');
  assert.equal(await compiled('(insert "compiled café") (buffer-size)'),'14');
  assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('compiled café'));
  console.log('ok editor bridge Unicode');
  const prompted=compiled('(insert (prompt "Compiled prompt: ")) (buffer-size)');
  await page.waitForTimeout(250);await page.keyboard.insertText(' input');await keys('Enter');
  assert.equal(await prompted,'20');
  console.log('ok asynchronous compiled editor prompt');
  assert.equal(await compiled('(fib 35)'),'9227465');
  await scheme('(begin (select-buffer "*compiled-command*") (erase-buffer))');
  await keys('Control+c','a');
  assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('<p> </p>'));
  assert.equal(await scheme('(get *schemer-command-compiled* (quote html-p) #f)'),'#t');
  await compiled('(call-with-output-file "/home/web_user/compiled-port.txt" (lambda (p) (display "shared café" p)))');
  assert.equal(await scheme('(file-contents "/home/web_user/compiled-port.txt")'),JSON.stringify('shared café'));
  const started=Date.now();
  assert.equal(await compiled('(fib 40)'),'102334155');
  console.log('compiled fib(40) ms including bridge:',Date.now()-started);

  assert.equal(await page.evaluate(()=>typeof window.createFemtoscheme),'undefined','The separate interpreter compiler VM must not be embedded');
  assert.equal(await compiled('(list (exact? (string->number "-9223372036854775808")) (number->string (string->number "-9223372036854775808")))'),'(#t "-9223372036854775808")');
  const status=JSON.parse(JSON.parse(await scheme('(web-request "schemer-status")')));
  assert.equal(status.compiler, "self-hosted WasmGC");
  assert.ok(status.executed>=3);assert.ok(status.editorCalls>=5);
  assert.deepEqual(errors,[]);
  console.log('compiled integration telemetry',status);
  // An unsupported browser must retain ordinary editing and evaluation.
  await page.addInitScript(()=>{WebAssembly.Suspending=undefined;WebAssembly.promising=undefined;});
  await page.reload();await page.waitForTimeout(1800);
  assert.equal(await scheme('(web-request "schemer-supported")'),JSON.stringify('compatibility'));
  assert.equal(await scheme('(+ 20 22)'),'42');
  await scheme('(begin (select-buffer "*compatibility*") (erase-buffer))');
  await keys('Control+c','a');
  assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('<p> </p>'));
  assert.deepEqual(errors,[]);
  console.log('all Schemer integration tests passed, including the no-JSPI compatibility path');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
