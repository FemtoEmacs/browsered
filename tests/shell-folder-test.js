const {chromium} = require('playwright');
const {spawn} = require('child_process');
const assert = require('assert/strict'), path = require('path'), os = require('os');
(async () => {
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
 console.log('all shell and folder tests passed: editable prefix, remembered directory, cancellation, reload, Esc !, output/status, timeout, origin checks');
 } finally {if(browser) await browser.close();child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
