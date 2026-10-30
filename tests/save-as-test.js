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
 await page.evaluate(()=>{FS.mkdir('/home/web_user/save-as');FS.mkdir('/home/web_user/save-as/nested');FS.writeFile('/home/web_user/save-as/unchanged.md','DO NOT MODIFY');localStorage.setItem('browsered-last-folder','~/save-as/');});
 await scheme('(begin (select-buffer "*save-as-test*") (erase-buffer) (insert "Save As café"))');
 await keys('Control+x','Control+w');await page.keyboard.insertText('nes');await keys('Tab');await page.keyboard.insertText('draft.md');await keys('Enter');await page.waitForTimeout(400);
 assert.equal(await scheme('(buffer-filename)'),JSON.stringify('/home/web_user/save-as/nested/draft.md'));
 assert.equal(await page.evaluate(()=>FS.readFile('/home/web_user/save-as/nested/draft.md',{encoding:'utf8'})),'Save As café');
 // The complete existing filename is editable, including its extension.
 await keys('Control+x','Control+w','Backspace','Backspace','Backspace');await page.keyboard.insertText('-copy.md');await keys('Enter');await page.waitForTimeout(300);
 assert.equal(await scheme('(buffer-filename)'),JSON.stringify('/home/web_user/save-as/nested/draft-copy.md'));
 // Tab completes an existing filename as well as directory components.
 await keys('Control+x','Control+w','Control+u');await page.keyboard.insertText('~/save-as/nested/draft-c');await keys('Tab','Enter');await page.waitForTimeout(300);
 assert.equal(await scheme('(buffer-filename)'),JSON.stringify('/home/web_user/save-as/nested/draft-copy.md'));
 await keys('Control+x','Control+w','Control+u');await page.keyboard.insertText('~/save-as/cancelled.md');await keys('Control+g');
 assert.equal(await scheme('(buffer-filename)'),JSON.stringify('/home/web_user/save-as/nested/draft-copy.md'));
 assert.equal(await page.evaluate(()=>FS.analyzePath('/home/web_user/save-as/cancelled.md').exists),false);
 assert.equal(await page.evaluate(()=>FS.readFile('/home/web_user/save-as/unchanged.md',{encoding:'utf8'})),'DO NOT MODIFY');
 assert.deepEqual(errors,[]);
 console.log('PASS real C-x C-w: editable folder and filename, directory/file Tab completion, Unicode, cancel without writing');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
