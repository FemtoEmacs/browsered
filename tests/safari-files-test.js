// Exercise the Safari fallback with native filesystem APIs absent.
const {chromium} = require('playwright'), {spawn} = require('child_process');
const fs=require('fs'), os=require('os'), path=require('path'), assert=require('assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'browsered-safari-'));
 fs.writeFileSync(path.join(dir,'teste.md'),'Original café.\n');
 fs.mkdirSync(path.join(dir,'sub'));
 fs.writeFileSync(path.join(dir,'sub','nested.txt'),'Nested.');
 fs.writeFileSync(path.join(dir,'untouched.bin'),Buffer.from([0,255,7,128]));
 fs.writeFileSync(path.join(dir,'quote"name.txt'),'Quoted.');
 const child=spawn(path.resolve('build/browsered-codex-bridge'),['--serve','--port','0','--page',path.resolve('Browsered.html')],{env:{...process.env,BROWSERED_CODEX:'/usr/bin/true'}});
 let browser;
 try {
 const base=await new Promise((resolve,reject)=>{child.stdout.once('data',b=>resolve(b.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]));child.once('error',reject);});
 const request=(op,file,data='',origin=base,type='application/x-browsered-files')=>fetch(base+'/files',{method:'POST',headers:{Origin:origin,'Content-Type':type},body:Buffer.concat([Buffer.from(op+'\n'+file+'\n'),Buffer.from(data)])});
 let response=await request('list',dir);assert.equal(response.status,200);assert.ok((await response.json()).some(f=>f.name==='quote"name.txt'));
 assert.equal((await request('read',dir+'/teste.md','','https://evil.example')).status,403);
 assert.equal((await request('read',dir+'/teste.md','',base,'text/plain')).status,403);
 assert.equal((await request('write',dir+'/teste.md','')).status,400);
 response=await request('write',dir+'/new.bin',Buffer.from([0,255,129,4]));assert.equal(response.status,200);assert.deepEqual(fs.readFileSync(dir+'/new.bin'),Buffer.from([0,255,129,4]));
 browser=await chromium.launch(process.env.BROWSERED_TEST_CHANNEL ? {channel:process.env.BROWSERED_TEST_CHANNEL} : {});
 const page=await browser.newPage();await page.addInitScript(()=>{Object.defineProperty(window,'showDirectoryPicker',{value:undefined});Object.defineProperty(window,'showOpenFilePicker',{value:undefined});});
 await page.goto(base+'/?advanced');await page.waitForTimeout(1800);
 const keys=async(...ks)=>{for(const k of ks) await page.keyboard.press(k);};
 const scheme=async expr=>{await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.type('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);await page.waitForTimeout(150);return page.evaluate(()=>Module.browsered._test);};
 page.once('dialog',d=>d.accept(dir));
 await keys('Control+x','Control+f');await page.keyboard.type('safari-fixture/teste.md');await keys('Enter');await page.waitForTimeout(1500);
 assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Original café.\n'));
 assert.equal(fs.readFileSync(dir+'/teste.md','utf8'),'Original café.\n');
 assert.deepEqual(fs.readFileSync(dir+'/untouched.bin'),Buffer.from([0,255,7,128]));
 await page.keyboard.type('Edited. ');await keys('Control+x','Control+s');await page.waitForTimeout(800);
 assert.equal(fs.readFileSync(dir+'/teste.md','utf8'),'Edited. Original café.\n');
 await keys('Control+x','Control+f','Control+u');await page.keyboard.type('~/safari-fixture/sub/n');await keys('Tab','Enter');await page.waitForTimeout(700);
 assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Nested.'));
 await page.reload();await page.waitForTimeout(1800);
 await keys('Control+x','Control+f','Control+u');await page.keyboard.type('~/safari-fixture/teste.md');await keys('Enter');await page.waitForTimeout(1000);
 assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Edited. Original café.\n'));
 await page.screenshot({path:'build/safari-files.png'});
 console.log('all Safari fallback tests passed: open/save, Unicode, nested completion, reload, binary writes, empty-write guard, unchanged browsing, origin checks');
 } finally {if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
