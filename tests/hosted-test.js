// Serve the Pages artifact under a project subpath with no local helper.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const requests=[];
 const server=http.createServer((q,r)=>{
  requests.push(q.url);
  const name=q.url.split('?')[0];
  if(!['/browsered/','/browsered/Browsered.html'].includes(name)){r.writeHead(404);r.end('Not found');return;}
  r.writeHead(200,{'Content-Type':'text/html'});
  r.end(fs.readFileSync(path.resolve('site',name.endsWith('Browsered.html')?'Browsered.html':'index.html')));
 });
 let browser;
 try {
  await new Promise(ok=>server.listen(0,ok));
  const base='http://localhost:'+server.address().port+'/browsered/';
  browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL?{channel:process.env.BROWSERED_TEST_CHANNEL}:{});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://api.openai.com/**',route=>{throw new Error('Hosted Codex must not call the paid API');});
  await page.goto(base);await page.waitForTimeout(2000);
  assert.equal(page.url(),base,'Hosted page must stay on the published origin');
  assert.equal(await page.locator('#screen').isVisible(),true);
  assert.equal(await page.locator('#editor').count(),0,'Start in the advanced editor');
  const keys=async(...ks)=>{for(const k of ks) await page.keyboard.press(k);};
  const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.type('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(150);return page.evaluate(()=>Module.browsered._test);};
  await keys('Control+x','Control+f','Control+u');await page.keyboard.type('~/hosted.txt');await keys('Enter');
  await page.keyboard.insertText('Hosted café draft.');await keys('Control+x','Control+s');await page.waitForTimeout(700);
  await page.reload();await page.waitForTimeout(2000);
  await keys('Control+x','Control+f');await page.keyboard.type('hosted.txt');await keys('Enter');
  assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Hosted café draft.'));
  await page.getByRole('button',{name:'Writing / Grammarly',exact:true}).click();
  await page.waitForSelector('#editor');assert.equal(await page.locator('#editor').inputValue(),'Hosted café draft.');
  await page.getByRole('button',{name:'ChatGPT',exact:true}).click();
  await page.getByLabel('ChatGPT request').fill('Explain this sentence.');
  await page.getByRole('button',{name:'Send to ChatGPT',exact:true}).click();
  await page.getByText(/Start Browsered.command/).waitFor();
  assert.ok(!requests.some(url=>/\/(codex|shell|files)(\/|$)/.test(url)), 'Hosted editing must not call helper endpoints');
  assert.deepEqual(errors,[]);
  assert.equal((await fetch(base+'Browsered.html')).status,200);
  assert.equal((await fetch(base+'tools/codex-bridge.c')).status,404);
  await page.screenshot({path:'build/hosted-editor.png'});
  console.log('all hosted-site tests passed: project URL, advanced startup, Unicode editing, saved draft across reload, Grammarly field, local-only Codex, no helper requests');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
