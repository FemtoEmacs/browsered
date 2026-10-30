// Test canvas startup and the optional Grammarly-compatible editor.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
(async () => {
  let browser, received = '';
  const server = http.createServer((q, r) => {
    if (q.url === '/codex') {
      let body = ''; q.on('data', b => {body += b;}); q.on('end', () => {
        received = body; r.writeHead(200, {'content-type':'text/plain'}); r.end('A test Codex answer.');
      }); return;
    }
    r.writeHead(200, {'content-type':'text/html'}); r.end(fs.readFileSync(path.resolve(__dirname, '..', 'Browsered.html')));
  });
  try {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL ? {channel:process.env.BROWSERED_TEST_CHANNEL} : {});
    const page = await browser.newPage({viewport:{width:1100,height:760}});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForSelector('#screen');
    assert.equal(await page.locator('#editor').count(), 0, 'Startup must stay in the advanced editor');
    await page.getByRole('button', {name:'Writing / Grammarly', exact:true}).click();
    await page.waitForSelector('#editor');
    assert.equal(await page.getByRole('button', {name:'Apply and return', exact:true}).count(), 0);
    assert.equal(await page.locator('#editor').getAttribute('spellcheck'), 'true');
    assert.ok((await page.locator('#editor').inputValue()).includes('Schememax in the browser'), 'Switching views must preserve the current buffer');
    await page.evaluate(() => {
      window.testWrites = [];
      const file = {name:'teste.md', kind:'file', getFile:async () => new File(['This page contens an error.'], 'teste.md'),
        createWritable:async () => {let data; return {write:async d => {data=d;}, close:async () => {
          window.testWrites.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
        }};}};
      window.showOpenFilePicker = async () => [file];
    });
    await page.getByRole('button', {name:'Open', exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#editor')?.value === 'This page contens an error.');
    assert.equal(await page.evaluate(() => window.testWrites.length), 0, 'Opening must never write the source file');
    await page.locator('#editor').fill('This page contains an error.');
    assert.equal(await page.evaluate(() => window.testWrites.length), 0, 'A writing correction must not save by itself');
    await page.screenshot({path:'build/default-document.png'});
    await page.getByRole('button', {name:'Save', exact:true}).click();
    await page.waitForSelector('#editor');
    await page.waitForFunction(() => window.testWrites.length === 1);
    assert.equal(await page.evaluate(() => window.testWrites[0]), 'This page contains an error.');
    assert.equal(await page.locator('#editor').inputValue(), 'This page contains an error.');
    await page.getByRole('button', {name:'ChatGPT', exact:true}).click();
    await page.getByLabel('ChatGPT request').fill('Explain this sentence.');
    await page.getByRole('button', {name:'Send to ChatGPT', exact:true}).click();
    await page.getByText('A test Codex answer.', {exact:true}).waitFor();
    assert.ok(received.includes('Explain this sentence.') && received.includes('This page contains an error.'));
    assert.equal(await page.locator('#editor').inputValue(), 'This page contains an error.');
    await page.getByRole('button', {name:'Advanced editor', exact:true}).click();
    await page.locator('#writing-mode').waitFor({state:'detached'});
    await page.getByRole('button', {name:'Writing / Grammarly', exact:true}).click();
    await page.waitForSelector('#editor');
    assert.equal(await page.locator('#editor').inputValue(), 'This page contains an error.');
    await page.locator('#editor').fill('Unsaved draft');
    page.once('dialog', d => d.dismiss());
    await page.getByRole('button', {name:'Quit', exact:true}).click();
    assert.equal(await page.locator('#editor').inputValue(), 'Unsaved draft');
    page.once('dialog', d => d.accept());
    await page.getByRole('button', {name:'Quit', exact:true}).click();
    await page.waitForSelector('#editor-closed');
    assert.deepEqual(errors, []);
    console.log('all document editor tests passed (advanced startup, optional textarea, open, corrections, explicit save, Codex, advanced mode, unsaved quit)');
  } finally {if(browser) await browser.close(); server.close();}
})().catch(e => {console.error(e); process.exitCode=1;});
