// Real Save As keystrokes, entirely in the disposable browser filesystem.
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
 assert.deepEqual(errors,[]);
 console.log('PASS buffer menu: Enter/1 opens, arrows/C-n/n/p navigate, q/C-g cancel, names with spaces/Unicode');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
