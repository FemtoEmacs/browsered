// Real search/replace typing after focus leaves the editor input field.
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
 const setup=async()=>scheme('(begin (select-buffer "search.txt") (erase-buffer) (deactivate-mark) (insert "one two one café") (goto-char 0))');
 const loseFocus=()=>page.evaluate(()=>{let b=document.getElementById('focus-fixture');if(!b){b=document.createElement('button');b.id='focus-fixture';b.textContent='fixture';document.body.append(b);}b.focus();});
 await setup();await loseFocus();await keys('Control+s');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'keys','search must restore typing focus');
 await page.keyboard.type('one');await keys('Enter');assert.equal(await scheme('(point)'), '3');
 await loseFocus();await keys('Control+s');await page.keyboard.type('one');await keys('Control+s','Enter');assert.equal(await scheme('(point)'), '11');
 await loseFocus();await keys('Control+r');await page.keyboard.type('one');await keys('Enter');assert.equal(await scheme('(point)'), '8');
 await keys('Control+a');await loseFocus();await keys('Escape','%');await page.keyboard.type('one');await keys('Enter');await page.keyboard.type('three');await keys('Enter','!');await page.waitForTimeout(100);
 assert.equal(await scheme('(buffer-substring 0 (buffer-size))'), JSON.stringify('three two three café'));
 await setup();await loseFocus();await keys('Control+s');await page.keyboard.type('missing');await keys('Control+g');assert.equal(await scheme('(point)'), '0');
 await loseFocus();await keys('Control+s');await page.keyboard.insertText('café');await keys('Enter');assert.equal(await scheme('(point)'), '17');
 assert.deepEqual(errors,[]);
 console.log('PASS C-s, C-r, M-%: lost focus, real typing, repeats, cancellation, Unicode, replace all');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
