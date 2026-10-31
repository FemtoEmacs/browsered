// C-x C-b by real keystrokes, entirely in the disposable browser filesystem.
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
 const long='zeta space.scm',unicode='café.scm';
 await scheme('(begin (select-buffer "alpha.txt") (insert "Alpha") (select-buffer "beta.txt") (insert "Beta") (select-buffer '+JSON.stringify(long)+') (insert "Long") (select-buffer '+JSON.stringify(unicode)+') (insert "Unicode"))');
 const menu=()=>keys('Control+x','Control+b');
 await menu();await keys('ArrowDown','Enter');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('alpha.txt'));
 await menu();await keys('Control+n','Control+n','Enter');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('beta.txt'));
 await menu();await keys('n','n','n','n','Enter');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify(long));assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Long'));
 await menu();await keys('n','n','n','Enter');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify(unicode));
 await menu();await keys('ArrowDown','q');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify(unicode));
 await menu();await keys('Control+n','Control+g');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify(unicode));
 await menu();await keys('ArrowDown','ArrowDown','ArrowUp','1');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('alpha.txt'));
 await menu();await keys('n','n','p','Enter');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('alpha.txt'));
 // two windows (C-x 2): the menu takes the selected one; RET and q keep both; 1 leaves one
 const wins=()=>scheme('(window-count)');
 await keys('Control+x','2');assert.equal(await wins(),'2');
 await menu();await keys('ArrowDown','Enter');
 assert.equal(await wins(),'2');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('alpha.txt'));
 await keys('Control+x','o');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('alpha.txt'));
 await menu();await keys('n','n','Enter');assert.equal(await wins(),'2');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('beta.txt'));
 await menu();await keys('q');assert.equal(await wins(),'2');assert.equal(await scheme('(get-buffer-name)'),JSON.stringify('beta.txt'));
 await menu();await keys('ArrowDown','1');assert.equal(await wins(),'1');
 // C-x right / C-x left, as in Emacs: next and previous buffer, and no "[C" or "[D" typed
 const name=()=>scheme('(get-buffer-name)');
 const start=await name(),texts=async()=>scheme('(list (begin (select-buffer "alpha.txt") (buffer-substring 0 (buffer-size))) (begin (select-buffer "beta.txt") (buffer-substring 0 (buffer-size))))');
 const before=await texts();await scheme('(select-buffer '+start+')');
 await keys('Control+x','ArrowRight');const next=await name();assert.notEqual(next,start,'C-x right moves to another buffer');
 await keys('Control+x','ArrowLeft');assert.equal(await name(),start,'C-x left comes back');
 await keys('Control+x','ArrowLeft');const prev=await name();await keys('Control+x','ArrowRight');assert.equal(await name(),start,'and C-x right goes forward again');
 await keys('Control+x','n');assert.equal(await name(),next,'C-x n is C-x right');
 assert.equal(await texts(),before,'no arrow bytes typed into a buffer');
 assert.deepEqual(errors,[]);
 console.log('PASS buffer menu and C-x left/right: Enter/1 opens, two windows kept (RET, q) and 1 alone, arrows/C-n/n/p navigate, q/C-g cancel, names with spaces/Unicode');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
