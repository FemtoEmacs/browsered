// Actual filename mouse action with boxed WebAssembly file timestamps.
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 let browser;
 try{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?advanced');await page.waitForTimeout(1800);
 const keys=async(...ks)=>{for(const k of ks)await page.keyboard.press(k);};
 const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.insertText('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(80);return page.evaluate(()=>Module.browsered._test);};
 await page.evaluate(()=>{const paint=Module.browsered.paint;Module.browsered.paint=function(ptr,rows,cols,...rest){const h=HEAP32.subarray(ptr>>2,(ptr>>2)+rows*cols*4);let lines=[];for(let y=0;y<rows;y++){let line='';for(let x=0;x<cols;x++)line+=String.fromCodePoint(h[(y*cols+x)*4]||32);lines.push(line.trimEnd());}Module.browsered._screen=lines;(Module.browsered._frames ||= []).push(lines.join("\n"));return paint.call(this,ptr,rows,cols,...rest);};FS.writeFile('/home/web_user/clock.md','Clock fixture café');FS.utime('/home/web_user/clock.md',1739365794000,1739365794000);});
 await keys('Control+x','Control+f','Control+u');await page.keyboard.insertText('~/clock.md');await keys('Enter');await page.waitForTimeout(200);
 const details=await scheme('(file-info-text)');assert.match(details,/saved 2025-\d\d-\d\d \d\d:\d\d/);
 const row=await page.evaluate(()=>Module.browsered._screen.findIndex(l=>l.includes('clock.md')&&l.includes('[SAVE]')));assert.ok(row>=0);
 const y=await page.evaluate(row=>{const font=document.querySelector('#screen').getContext('2d').font;const size=Number(font.match(/([0-9.]+)px/)[1]);return (Math.round(4*devicePixelRatio)+(row+.5)*Math.round(size*1.3))/devicePixelRatio;},row);await page.mouse.click(20,y);
 await page.waitForFunction(()=>Module.browsered._frames.some(t=>t.includes('File:')&&t.includes('clock.md')));
 const info=await page.evaluate(()=>Module.browsered._screen.join('\n'));assert.match(info,/Clock|clock.md/);assert.doesNotMatch(info,/expected fixnum|type error/);
 await keys('x');assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Clock fixture café'));
 assert.equal(await scheme('(string-length (format-time 2200000000))'),'16');
 assert.deepEqual(errors,[]);
 console.log('PASS filename click: modern boxed timestamp, file info, no source changes, post-2038 timestamp');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
