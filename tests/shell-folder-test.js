const {chromium} = require('playwright');
const {spawn} = require('child_process');
const assert = require('assert/strict'), path = require('path'), os = require('os'), fs = require('fs');
(async () => {
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'browsered-command-'));
 const child = spawn(path.resolve('build/browsered-codex-bridge'), ['--serve','--port','0','--page',path.resolve('Browsered.html')], {env:{...process.env,BROWSERED_CODEX:'/usr/bin/true'}});
 let browser;
 try {
 const base = await new Promise((resolve,reject) => {child.stdout.once('data',b => resolve(b.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]));child.once('error',reject);});
 const request = async (body, origin=base, type='application/x-browsered-shell') => fetch(base+'/shell',{method:'POST',headers:{Origin:origin,'Content-Type':type},body});
 let res = await request('5\n'+os.tmpdir()+'\nprintf "shell works"; exit 7'); assert.equal(res.status,200);assert.equal(await res.text(),'7\nshell works');
 res = await request('5\n~/\npwd'); assert.equal(res.status,200); assert.equal((await res.text()).trim(),'0\n'+process.env.HOME);
 assert.equal((await request('5\n'+os.tmpdir()+'\npwd','https://untrusted.example')).status,403);
 assert.equal((await request('5\n'+os.tmpdir()+'\npwd',base,'text/plain')).status,403);
 assert.equal((await request('5\n/no-such-browsered-directory\npwd')).status,400);
 res = await request('1\n'+os.tmpdir()+'\nsleep 5'); assert.equal(await res.text(),'-1\n');
 browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL ? {channel:process.env.BROWSERED_TEST_CHANNEL} : {});
 const page = await browser.newPage();await page.goto(base);await page.waitForTimeout(1800);
 const keys = async (...ks) => {for(const k of ks) await page.keyboard.press(k);};
 const scheme = async expr => {await page.evaluate(()=>Module.browsered._test=null);await keys('Escape',':');await page.keyboard.type('(web-request "test-result" (with-output-to-string (lambda () (write '+expr+'))))');await keys('Enter');await page.waitForFunction(()=>Module.browsered._test!==null);return page.evaluate(()=>Module.browsered._test);};
 // First prompt starts at ~/; Backspace edits the prefilled text.
 await keys('Control+x','Control+f','Backspace');await page.keyboard.type('/first.txt');await keys('Enter');
 assert.equal(await scheme('(buffer-filename)'), '"/home/web_user/first.txt"');
 await page.evaluate(()=>{FS.mkdir('/home/web_user/folder');});
 await keys('Control+x','Control+f');await page.keyboard.type('folder/one.txt');await keys('Enter');
 assert.equal(await scheme('(buffer-filename)'), '"/home/web_user/folder/one.txt"');
 assert.equal(await page.evaluate(()=>localStorage.getItem('browsered-last-folder')),'~/folder/');
 await keys('Control+x','Control+f');await page.screenshot({path:'build/remembered-folder.png'});await page.keyboard.type('two.txt');await keys('Enter');
 assert.equal(await scheme('(buffer-filename)'), '"/home/web_user/folder/two.txt"');
 await keys('Control+x','Control+f','Control+u');await page.keyboard.type('/cancelled/');await keys('Control+g');
 assert.equal(await page.evaluate(()=>localStorage.getItem('browsered-last-folder')),'~/folder/');
 await page.reload();await page.waitForTimeout(1800);
 assert.equal(await page.evaluate(()=>localStorage.getItem('browsered-last-folder')),'~/folder/');
 // Exercise the actual Esc ! workflow against the real helper.
 await keys('Escape','!');await page.keyboard.type('printf BROWSERED_SHELL_OK');await keys('Control+c','s');await page.waitForTimeout(700);
 const output = await scheme('(buffer-substring 0 (buffer-size))');
 assert.ok(output.includes('\\nBROWSERED_SHELL_OK'), 'Shell result must contain command output on its own line');
 assert.ok(!output.includes('exit status 127'));
 const localResult=await page.evaluate(async()=>JSON.parse(await Module.browsered.call('shell-run',JSON.stringify({command:'printf "full shell" | tr a-z A-Z; exit 7',directory:'~/',timeout:5}))));
 assert.deepEqual(localResult,['FULL SHELL','',7],'Local launcher must retain real programs, pipes and exit statuses');
 // Directory changes from the real shell persist into both command interfaces
 // and the next file prompt, even for native paths outside the virtual HOME.
 const nativeDir=path.join(fixture,'space café');fs.mkdirSync(nativeDir);
 fs.writeFileSync(path.join(nativeDir,'native.txt'),'Native source stays intact.');
 const commandText='cd "'+fixture+'/spa';
 await keys('Control+c','m');await page.keyboard.type(commandText);await keys('Tab','Enter');await page.waitForTimeout(500);
 const nativePath=fs.realpathSync(nativeDir);
 assert.equal(await page.evaluate(()=>localStorage.getItem('browsered-last-folder')),nativePath+'/');
 await keys('Control+c','m');await page.keyboard.type('ls n');await keys('Tab','Enter');await page.waitForTimeout(400);
 assert.ok((await scheme('(buffer-substring 0 (buffer-size))')).includes('native.txt'));
 await keys('Control+c','Control+f');await page.keyboard.type('native.txt');await keys('Enter');await page.waitForTimeout(600);
 assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify('Native source stays intact.'));
 assert.equal(fs.readFileSync(path.join(nativeDir,'native.txt'),'utf8'),'Native source stays intact.');
 await keys('Escape','!');await page.keyboard.type('cd ..');await keys('Control+c','s');await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>localStorage.getItem('browsered-last-folder')),fs.realpathSync(fixture)+'/');
 await keys('Control+c','m');await page.keyboard.type('pwd');await keys('Enter');await page.waitForTimeout(400);
 assert.ok((await scheme('(buffer-substring 0 (buffer-size))')).includes(fs.realpathSync(fixture)));
 await page.route('**/shell',route=>route.fulfill({status:503,body:'Local helper unavailable.'}));
 const unavailable=await page.evaluate(async()=>JSON.parse(await Module.browsered.call('shell-run',JSON.stringify({command:'pwd',directory:'~/',timeout:5}))));
 assert.deepEqual(unavailable,['Local helper unavailable.','',127],'Do not silently downgrade local shell requests');


 console.log('all shell and folder tests passed: editable prefix, remembered directory, cancellation, reload, Esc !, output/status, timeout, origin checks');
 } finally {if(browser) await browser.close();child.kill();fs.rmSync(fixture,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
