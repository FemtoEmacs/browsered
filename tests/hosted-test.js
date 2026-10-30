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
  // A granted folder, with lazy nested directories: browsing must never write it.
  await page.evaluate(()=>{
    window.shellWrites=0;
    const file=(name,text)=>({name,kind:'file',getFile:async()=>new File([text],name,{lastModified:1000}),
      createWritable:async()=>{window.shellWrites++;throw new Error('Interpreter must not write files');}});
    const dir=(name,items)=>({name,kind:'directory',values:async function*(){yield* items;}});
    window.showDirectoryPicker=async()=>dir('granted',[file('report.md','Report.'),file('.hidden','Hidden.'),
      dir('space café',[file('nested.txt','Nested.')])]);
  });
  const command=async text=>page.evaluate(async text=>JSON.parse(await Module.browsered.call('shell-run',JSON.stringify({command:'exec 2>&1\n'+text,directory:'/home/web_user'}))),text);
  assert.equal((await command('pwd'))[0],'~\n');
  assert.equal((await command('ls ~/granted'))[0],'report.md\nspace café/\n');
  assert.ok((await command('ls -al ~/granted'))[0].includes('.hidden'));
  assert.equal((await command('cd "~/granted/space café" && ls'))[0],'~/granted/space café\nnested.txt\n');
  assert.equal((await command('pwd'))[0],'~/granted/space café\n');
  assert.equal((await command('cd -'))[0],'~\n');
  assert.equal((await command('cd ~/granted; pwd'))[0],'~/granted\n~/granted\n');
  assert.equal((await command('ls "space café"'))[0],'nested.txt\n');
  assert.equal((await command('cd /missing-browsered-folder && pwd'))[2],1);
  assert.equal((await command('pwd'))[0],'~/granted\n','Failed cd must keep the current directory');
  assert.equal((await command('rm report.md'))[2],127);
  assert.equal((await command('ls | pwd'))[2],2);
  assert.equal((await command('pwd > report.md'))[2],2);
  assert.equal((await command('cd "unterminated'))[2],2);
  assert.equal((await command('ls -R'))[2],1);
  assert.equal(await page.evaluate(()=>window.shellWrites),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('browsered-last-folder')),'~/granted/');
  // Use the editor's real Esc ! / C-c s flow as well as its request interface.
  await keys('Escape','!');await page.keyboard.type('pwd');await keys('Control+c','s');await page.waitForTimeout(250);
  assert.ok((await scheme('(buffer-substring 0 (buffer-size))')).includes('~/granted'));
  // cd must override the file's old directory in both file-open bindings.
  await keys('Control+c','Control+f');await page.keyboard.type('report.md');await keys('Enter');
  assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Report.'));
  await keys('Control+c','m');await page.keyboard.type('cd "space');await keys('Tab','Enter');await page.waitForTimeout(200);
  assert.equal((await command('pwd'))[0],'~/granted/space café\n');
  await keys('Control+x','Control+f');await page.keyboard.type('nested.txt');await keys('Enter');
  assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Nested.'));
  await keys('Control+c','m');await page.keyboard.type('ls n');await keys('Tab','Enter');await page.waitForTimeout(200);
  assert.ok((await scheme('(buffer-substring 0 (buffer-size))')).includes('nested.txt'));
  await keys('Control+c','m');await page.keyboard.type('cd ..');await keys('Enter');await page.waitForTimeout(200);
  await keys('Control+c','m');await page.keyboard.type('cd "space');await keys('Tab','Control+g');
  assert.equal((await command('pwd'))[0],'~/granted\n','Cancel must not run a completed command');
  await scheme('(find-file "/home/web_user/hosted.txt")');
  await page.keyboard.press('Escape');await page.keyboard.press('x');await page.keyboard.insertText('document-editor');await page.keyboard.press('Enter');   // M-x document-editor: the old writing view (C-c d is the Grammarly pane)
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
  console.log('all hosted-site tests passed: project URL, advanced startup, Unicode editing, saved draft across reload, Grammarly field, browser ls/cd/pwd and quoted paths, no writes, local-only Codex, no helper requests');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
