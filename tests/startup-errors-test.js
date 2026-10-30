// Extension exceptions must not masquerade as editor failures.
const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync('Browsered.html'));});
 let browser;
 try {
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>Module.browsered && Module.browsered.painted());
  const notice=()=>page.locator('#notice').isVisible();
  assert.equal(await notice(),false);
  const message="Cannot read properties of undefined (reading 'M_ID')";
  for(const protocol of ['chrome-extension','moz-extension','safari-extension','safari-web-extension','ms-browser-extension']) {
   await page.evaluate(({protocol,message})=>window.dispatchEvent(new ErrorEvent('error',{
    message,filename:protocol+'://fixture/executors/200.js',error:new TypeError(message)
   })),{protocol,message});
   assert.equal(await notice(),false,protocol+' errors must stay in the console');
  }
  const rejection=async stack=>page.evaluate(({stack,message})=>{
   const error=new TypeError(message);error.stack=stack;
   window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:error}));
  },{stack,message});
  await rejection('TypeError: '+message+'\n    at Y (chrome-extension://fixture/executors/200.js:1:761)');
  assert.equal(await notice(),false);
  await rejection('Y@moz-extension://fixture/executors/200.js:1:761');
  assert.equal(await notice(),false);
  // Real input and evaluation continue after an injected extension error.
  await page.keyboard.press('Escape');await page.keyboard.press(':');
  await page.keyboard.insertText('(web-request "test-result" (number->string (+ 20 22)))');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>Module.browsered._test==='42');
  await page.evaluate(message=>window.dispatchEvent(new ErrorEvent('error',{
   message,filename:location.href,error:new TypeError(message)
  })),message);
  assert.equal(await notice(),true,'An identical error in Browsered must still be reported');
  assert.match(await page.locator('#notice').textContent(),/Browsered failed:.*M_ID/);
  await page.evaluate(()=>{document.getElementById('notice').hidden=true;});
  await rejection('TypeError: '+message+'\n    at editor (http://127.0.0.1/Browsered.html:1:2)\n    at extension (chrome-extension://fixture/script.js:1:3)');
  assert.equal(await notice(),true,'An extension later in the stack must not hide our own error');
  await page.evaluate(()=>{document.getElementById('notice').hidden=true;window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:'unknown failure'}));});
  assert.equal(await notice(),true,'Unknown failures must remain visible');
  console.log('PASS error attribution: extension sources ignored, editor and unknown errors visible, editing still works');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
