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
 const set=async(value,pos=0)=>{await editor.evaluate((e,args)=>{e.value=args[0];e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.setSelectionRange(args[1],args[1]);},[value,pos]);};
 const pos=()=>editor.evaluate(e=>[e.selectionStart,e.selectionEnd]);
 await set('alpha beta\n  second\nthird',3);
 await keys('Control+a');assert.deepEqual(await pos(),[0,0]);await keys('Control+e');assert.deepEqual(await pos(),[10,10]);
 await keys('Control+b');assert.deepEqual(await pos(),[9,9]);await keys('Control+f');assert.deepEqual(await pos(),[10,10]);
 await keys('Control+a','Control+n');assert.deepEqual(await pos(),[11,11]);await keys('Control+p');assert.deepEqual(await pos(),[0,0]);
 await keys('Escape','f');assert.deepEqual(await pos(),[5,5]);await keys('Escape','b');assert.deepEqual(await pos(),[0,0]);
 await keys('Control+Space','Control+f','Control+f');assert.deepEqual(await pos(),[0,2]);
 await keys('Control+w');assert.equal(await editor.inputValue(),'pha beta\n  second\nthird');await keys('Control+y');assert.equal(await editor.inputValue(),'alpha beta\n  second\nthird');
 await set('one\ntwo\nthree',0);await keys('Control+k','Control+k');assert.equal(await editor.inputValue(),'two\nthree');await keys('Control+y');assert.equal(await editor.inputValue(),'one\ntwo\nthree');
 await set('café 😀 end',7);await keys('Control+b');assert.deepEqual(await pos(),[5,5]);await keys('Control+f');assert.deepEqual(await pos(),[7,7]);
 await set('',0);await page.keyboard.insertText('café 😀');assert.equal(await editor.inputValue(),'café 😀');
 await set('one two',0);await keys('Escape','d');assert.equal(await editor.inputValue(),' two');await keys('Control+y');assert.equal(await editor.inputValue(),'one two');
 await set('one two',7);await keys('Alt+Backspace','Alt+Backspace','Control+y');assert.equal(await editor.inputValue(),'one two');
 await set('one two',0);await keys('Control+Space','Escape','f','Escape','w','Control+e','Control+y');assert.equal(await editor.inputValue(),'one twoone');
 await set('undo',4);await page.keyboard.type(' test');await keys('Control+/');assert.equal(await editor.inputValue(),'undo');
 await set('  table\tcolumn\n    aligned',7);await keys('Tab');assert.equal(await editor.inputValue(),'  table\t\tcolumn\n    aligned');
 await keys('Control+x','h');assert.deepEqual(await pos(),[0,(await editor.inputValue()).length]);await keys('Control+g');assert.equal((await pos())[0],(await pos())[1]);
 const many=Array.from({length:120},(_,i)=>'line '+i).join('\n');await set(many,0);
 await keys('Control+End');assert.deepEqual(await pos(),[many.length,many.length]);assert.ok(await editor.evaluate(e=>e.scrollTop>0));
 await page.waitForTimeout(80);const caret=page.locator('.writing-caret');assert.equal(await caret.isVisible(),true);assert.equal(await caret.evaluate(e=>getComputedStyle(e).width),'3px');assert.equal(await caret.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(240, 198, 116)');   // the editor's yellow, on its dark background
 await keys('Control+Home');assert.deepEqual(await pos(),[0,0]);assert.equal(await editor.evaluate(e=>e.scrollTop),0);await page.waitForTimeout(80);await page.screenshot({path:'build/writing-caret.png'});
 await keys('Escape','>');assert.deepEqual(await pos(),[many.length,many.length]);await keys('Escape','<');assert.deepEqual(await pos(),[0,0]);
 await keys('Alt+Shift+Period');assert.deepEqual(await pos(),[many.length,many.length]);await keys('Alt+Shift+Comma');assert.deepEqual(await pos(),[0,0]);
 await keys('Control+v');assert.ok((await pos())[0]>0);await keys('Escape','v');assert.deepEqual(await pos(),[0,0]);
 await keys('Control+Shift+End');assert.deepEqual(await pos(),[0,many.length]);await page.waitForTimeout(80);assert.equal(await caret.isVisible(),false);
 await keys('Control+g','Control+Home');await page.waitForTimeout(80);assert.equal(await caret.isVisible(),true);
 await editor.evaluate(e=>{e.scrollTop=300;});await page.waitForTimeout(80);assert.equal(await caret.isVisible(),false);await keys('Control+Home');await page.waitForTimeout(80);assert.equal(await caret.isVisible(),true);
 const style=await editor.evaluate(e=>({font:getComputedStyle(e).fontFamily,white:getComputedStyle(e).whiteSpace,tab:getComputedStyle(e).tabSize,wrap:e.wrap}));assert.match(style.font,/monospace/);assert.equal(style.white,'pre');assert.equal(style.tab,'8');assert.equal(style.wrap,'off');
 const formatted='  a  b\n\t1  2\n'+ 'long '.repeat(80);await set(formatted);assert.equal(await editor.evaluate(e=>e.scrollWidth>e.clientWidth),true);
 await page.getByRole('button',{name:'Advanced editor',exact:true}).click();await editor.waitFor({state:'detached'});assert.equal(await scheme('(buffer-substring 0 (buffer-size))'),JSON.stringify(formatted).replace(/\\t/g,'\t'));
 // The temporary Apply/Cancel writing view uses the same keyboard handler.
 await page.evaluate(()=>{Module.browsered.call('writing-mode',JSON.stringify({persistent:false,name:'Temporary',text:'abc',point:3})).then(r=>window.writingResult=r);});
 const temporary=page.locator('#writing-text');await temporary.waitFor();await keys('Control+a','Control+k');assert.equal(await temporary.inputValue(),'');await keys('Control+y');assert.equal(await temporary.inputValue(),'abc');await page.getByRole('button',{name:'Apply and return',exact:true}).click();await page.waitForFunction(()=>window.writingResult);assert.equal(await page.evaluate(()=>JSON.parse(window.writingResult).text),'abc');
 assert.deepEqual(errors,[]);
 console.log('PASS writing Emacs keys: movement, region, kill/yank, undo, Unicode, tabs, fixed-width/no-wrap, round trip, both writing views, file/page movement, steady high-contrast caret');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
