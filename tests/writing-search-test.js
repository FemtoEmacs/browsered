// Emacs editing in both real Grammarly-compatible textarea views.
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
 await scheme('(begin (select-buffer "writing.txt") (erase-buffer) (insert "Original"))');
 await page.keyboard.press('Escape');await page.keyboard.press('x');await page.keyboard.insertText('document-editor');await page.keyboard.press('Enter');   // M-x document-editor: the old writing view (C-c d is the Grammarly pane)
 const editor=page.locator('#editor');await editor.waitFor();
 const set=async(value,pos=0)=>editor.evaluate((e,args)=>{e.value=args[0];e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.setSelectionRange(args[1],args[1]);},[value,pos]);
 await set('one two one café',0);
 await page.evaluate(()=>{window.snippets=0;document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='s')window.snippets++;},true);});
 const caret=()=>editor.evaluate(e=>[e.selectionStart,e.selectionEnd,document.activeElement===e]);
 const search=page.getByRole('textbox',{name:'Search document',exact:true});
 await keys('Control+s');await search.waitFor();await page.keyboard.type('one');assert.deepEqual(await caret(),[0,0,true]);
 await keys('Control+s');assert.deepEqual(await caret(),[8,8,true]);
 await keys('Control+r');assert.deepEqual(await caret(),[0,0,true]);
 // Movement accepts the live search and runs immediately: no Enter needed.
 await keys('Control+f');await search.waitFor({state:'detached'});assert.deepEqual(await caret(),[1,1,true]);
 await page.keyboard.type('X');assert.equal(await editor.inputValue(),'oXne two one café');
 await keys('Control+s');assert.deepEqual(await caret(),[9,9,true]);
 await keys('Control+d');await search.waitFor({state:'detached'});assert.equal(await editor.inputValue(),'oXne two ne café');
 await set('one two one café',16);await keys('Control+r');await page.keyboard.insertText('café');assert.deepEqual(await caret(),[12,12,true]);
 await keys('Control+g');assert.deepEqual(await caret(),[16,16,true]);
 await keys('Control+s');await page.keyboard.type('missing');await page.getByRole('status').filter({hasText:'Not found'}).waitFor();await keys('Control+g');assert.equal(await editor.inputValue(),'one two one café');
 const distant=('line\n').repeat(120)+'target';await set(distant,0);await editor.evaluate(e=>e.scrollTop=0);await keys('Control+s');await page.keyboard.type('target');assert.deepEqual(await caret(),[600,600,true]);assert.ok(await editor.evaluate(e=>e.scrollTop>0),'offscreen match must be revealed');await keys('Enter');
 assert.equal(await page.evaluate(()=>window.snippets),0,'document-level snippet shortcut must not receive C-s');
 await page.getByRole('button',{name:'Advanced editor',exact:true}).click();await editor.waitFor({state:'detached'});
 await scheme('(goto-char 0)');await keys('Control+s');await page.keyboard.type('target');await keys('Enter');assert.equal(await scheme('(point)'), '606');
 assert.deepEqual(errors,[]);
 console.log('PASS live writing search: document focus, caret before match, repeats without Enter, immediate movement/editing, recall, Unicode, cancel, scrolling, no snippet propagation');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
