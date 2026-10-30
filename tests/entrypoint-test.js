// Verify the ordinary file entry point redirects, and explicit offline mode stays local.
const {chromium} = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const assert = require('assert/strict');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browsered-entry-'));
  const server = http.createServer((q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end('<h1>Connected Browsered</h1>'); });
  let browser;
  try {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const target = 'http://127.0.0.1:' + server.address().port + '/';
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'Browsered.html'), 'utf8');
    assert.ok(source.includes('location.replace("http://127.0.0.1:8767/")'));
    const fixture = path.join(dir, 'Browsered.html');
    fs.writeFileSync(fixture, source.replace('location.replace("http://127.0.0.1:8767/")', 'location.replace(' + JSON.stringify(target) + ')'));
    browser = await chromium.launch(process.env.BROWSERED_TEST_CHANNEL ? {channel:process.env.BROWSERED_TEST_CHANNEL} : {});
    const page = await browser.newPage();
    await page.goto('file://' + fixture);
    await page.waitForURL(target);
    assert.equal(await page.getByRole('heading').innerText(), 'Connected Browsered');
    await page.goto('file://' + fixture + '?standalone');
    await page.waitForTimeout(2000);
    assert.ok(page.url().startsWith('file://'));
    await page.waitForSelector('#screen');
    assert.equal(await page.locator('#screen').isVisible(), true);
    assert.equal(await page.locator('#editor').count(), 0);
    console.log('all entry-point tests passed: normal file opens the connected page; ?standalone stays offline');
  } finally {
    if (browser) await browser.close();
    server.close(); fs.rmSync(dir, {recursive:true, force:true});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
