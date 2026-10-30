// Real shell-buffer TAB and C-c m, using a disposable browser filesystem.
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 let browser;
 try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:'+server.address().port);await page.waitForTimeout(1800);
 const keys=async(...ks)=>{for(const k of ks)await page.keyboard.press(k);};
 const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.insertText('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(80);return page.evaluate(()=>Module.browsered._test);};
 await page.evaluate(()=>{FS.mkdir('/home/web_user/tab-shell');FS.mkdir('/home/web_user/tab-shell/nested');FS.mkdir('/home/web_user/tab-shell/space dir');for(const name of ['source.md','café.md','alpha-one','alpha-two'])FS.writeFile('/home/web_user/tab-shell/'+name,'Fixture');FS.writeFile('/home/web_user/tab-shell/nested/witness.txt','Keep');});
 await scheme('(find-file "/home/web_user/tab-shell/source.md")');
 await keys('Escape','!');await page.keyboard.type('cd ~/tab-shell/ne');await keys('Tab');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('cd ~/tab-shell/nested/'));
 const set=async(text,pos=text.length)=>scheme('(begin (erase-buffer) (insert '+JSON.stringify(text)+') (goto-char '+pos+'))');
 await set('ls ~/tab-shell/ne | pwd','ls ~/tab-shell/ne'.length);await keys('Tab');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('ls ~/tab-shell/nested/ | pwd'));
 await set('cd "~/tab-shell/sp');await keys('Tab');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('cd ~/"tab-shell/space dir/"'));
 await set('cat ~/tab-shell/caf');await keys('Tab');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('cat ~/tab-shell/café.md'));
 await set('cat ~/tab-shell/a');await keys('Tab');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('cat ~/tab-shell/alpha-'));
 await keys('Tab');const first=await scheme('(buffer-substring 0 (buffer-size))');await keys('Tab');const second=await scheme('(buffer-substring 0 (buffer-size))');assert.notEqual(first,second);assert.ok(first.includes('alpha-'));assert.ok(second.includes('alpha-'));
 await set('cd ~/tab-shell/ne; touch ~/SHOULD_NOT_EXIST','cd ~/tab-shell/ne'.length);await keys('Tab');assert.equal(await page.evaluate(()=>FS.analyzePath('/home/web_user/SHOULD_NOT_EXIST').exists),false);
 // Returning to a normal document must keep ordinary TAB behavior.
 await keys('Control+x','1');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Fixture'));
 await keys('Control+c','m');await page.keyboard.type('ls ~/tab-shell/ne');await keys('Tab','Enter');await page.waitForTimeout(300);assert.ok((await scheme('(buffer-substring 0 (buffer-size))')).includes('witness.txt'));
 assert.deepEqual(errors,[]);
 console.log('PASS shell-buffer TAB: paths, quotes, Unicode, mid-command suffix, common prefix/cycling, no execution, C-c m');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
