// Exercise the real C bridge with a fake CLI. No model calls or credentials.
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const http = require('http'), {spawn} = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'browsered bridge '));
const fake = path.join(temp, 'fake-codex');
const log = path.join(temp, 'requests');
fs.writeFileSync(fake, `#!/bin/sh
set -e
if [ -n "\${OPENAI_API_KEY:-}\${CODEX_API_KEY:-}\${OPENAI_BASE_URL:-}\${CODEX_BASE_URL:-}" ]; then
  echo 'API credentials were inherited' >&2; exit 9
fi
for arg do
  if [ "$arg" = status ]; then
    if [ -f "$BROWSERED_TEST_API_AUTH" ]; then echo 'Logged in using an API key'; else echo 'Logged in using ChatGPT'; fi
    exit 0
  fi
done
printf '%s\\n' "$PWD" >> "$BROWSERED_TEST_LOG"
out=
next=
images=0
sandbox=
for arg do
  if [ "$next" = output ]; then out=$arg; fi
  if [ "$next" = image ]; then test -s "$arg"; images=$((images+1)); fi
  if [ "$next" = sandbox ]; then sandbox=$arg; fi
  next=
  case "$arg" in --output-last-message) next=output ;; --image) next=image ;; --sandbox) next=sandbox ;; esac
done
test "$sandbox" = read-only
request=$(cat)
if [ "$request" = FAIL ]; then echo 'fake CLI failure' >&2; exit 7; fi
printf 'Codex allowance reply: %s; images=%s' "$request" "$images" > "$out"
`, {mode: 0o700});
// a fake claude (Claude Code): no API credentials, no tools, the question
// as the last argument, the context on standard input
const fakeClaude = path.join(temp, 'fake-claude');
fs.writeFileSync(fakeClaude, `#!/bin/sh
if [ -n "\${ANTHROPIC_API_KEY:-}\${ANTHROPIC_AUTH_TOKEN:-}\${ANTHROPIC_BASE_URL:-}" ]; then
  echo 'API credentials were inherited' >&2; exit 9
fi
test "$1" = -p && test "$2" = --tools && test "$3" = "" || { echo "bad arguments: $*" >&2; exit 8; }
for last do :; done
context=$(cat)
if [ "$last" = FAIL ]; then echo 'Not logged in: run /login' >&2; exit 1; fi
printf 'Claude subscription reply to [%s] about [%s]' "$last" "$context"
`, {mode: 0o700});
const child = spawn(path.join(root, 'build/browsered-codex-bridge'),
  ['--serve', '--port', '0', '--page', path.join(root, 'Browsered.html')], {
    env: {...process.env, BROWSERED_CODEX: fake, BROWSERED_CLAUDE: fakeClaude, BROWSERED_TEST_LOG: log,
      ANTHROPIC_API_KEY: 'dummy-key-that-must-not-be-used',
      BROWSERED_TEST_API_AUTH: path.join(temp, 'api-auth'),
      OPENAI_API_KEY: 'dummy-key-that-must-not-be-used', CODEX_API_KEY: 'dummy', OPENAI_BASE_URL: 'https://invalid.example'}
  });
let output = '';
const started = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Bridge startup timeout: ' + output)), 10000);
  child.stdout.on('data', b => { output += b; const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  child.stderr.on('data', b => { output += b; });
  child.on('error', reject);
  child.on('exit', code => { clearTimeout(timer); reject(new Error('Bridge exited: ' + code + ' ' + output)); });
});
(async () => {
  try {
    const port = await started, origin = `http://127.0.0.1:${port}`;
    const request = (method, route, body = '', headers = {}) => new Promise((resolve, reject) => {
      const q = http.request({host: '127.0.0.1', port, method, path: route,
        headers: {Origin: origin, 'Content-Type': 'application/x-browsered-codex',
          'Content-Length': Buffer.byteLength(body), ...headers}}, r => {
          let text = ''; r.on('data', b => { text += b; });
          r.on('end', () => resolve({status: r.statusCode, text}));
        });
      q.on('error', reject); q.end(body);
    });
    assert.equal((await request('GET', '/')).status, 200);
    assert.match((await request('GET', '/codex/status')).text, /API billing disabled/);
    assert.equal((await request('GET', '/../../.codex/auth.json')).status, 404);
    assert.equal((await request('POST', '/codex', '\n0\nhello', {Origin: 'https://evil.example'})).status, 403);
    assert.equal((await request('POST', '/codex', '\n0\nhello', {Host: 'evil.example'})).status, 403);
    assert.equal((await request('POST', '/codex', '\n0\nhello', {'Content-Type': 'text/plain'})).status, 403);
    assert.equal((await request('POST', '/codex', '\n33\nhello')).status, 400);
    assert.equal(fs.existsSync(log), false, 'Rejected requests must not invoke Codex');
    let r = await request('POST', '/codex', '\n0\nhello café\nsecond line');
    assert.equal(r.status, 200); assert.match(r.text, /hello café\nsecond line; images=0/);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    r = await request('POST', '/codex', 'test-model\n1\n' + png + '\ntranscribe');
    assert.equal(r.status, 200); assert.match(r.text, /images=1/);
    r = await request('POST', '/codex', '\n0\nFAIL');
    assert.equal(r.status, 502); assert.match(r.text, /fake CLI failure/);
    fs.writeFileSync(path.join(temp, 'api-auth'), '');
    const before = fs.readFileSync(log, 'utf8');
    r = await request('POST', '/codex', '\n0\nhello');
    assert.equal(r.status, 502); assert.match(r.text, /not signed in with ChatGPT/);
    assert.equal(fs.readFileSync(log, 'utf8'), before, 'API-key login must not run inference');
    before.trim().split('\n').forEach(dir => assert.equal(fs.existsSync(dir), false, 'Private workspace must be removed'));
    // Claude Code
    assert.equal((await request('GET', '/claude/status')).text, 'Browsered Claude bridge: ' + fakeClaude);
    const claudeBody = (sys, q, ctx) => '\n' + Buffer.byteLength(sys) + '\n' + Buffer.byteLength(q) + '\n' + sys + q + ctx;
    const claudeType = {'Content-Type': 'application/x-browsered-claude'};
    assert.equal((await request('POST', '/claude', claudeBody('S', 'Q', 'C'))).status, 403, 'the Codex type is refused');
    assert.equal((await request('POST', '/claude', claudeBody('S', 'Q', 'C'), {...claudeType, Origin: 'https://evil.example'})).status, 403);
    assert.equal((await request('POST', '/claude', '\n99\n1\nab', claudeType)).status, 400);
    r = await request('POST', '/claude', claudeBody('Be brief.', 'What is ação?', '(define x 1)\n<<CURSOR>>'), claudeType);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.text, 'Claude subscription reply to [What is ação?] about [(define x 1)\n<<CURSOR>>]');
    r = await request('POST', '/claude', claudeBody('S', 'FAIL', ''), claudeType);
    assert.equal(r.status, 502); assert.match(r.text, /Not logged in/);
    console.log('all Claude bridge tests passed (subscription only, origin checks)');
    // C-x C-c: only the page's own origin and type stop the launcher
    assert.equal((await request('POST', '/quit', 'quit', {'Content-Type': 'application/x-browsered-quit', Origin: 'https://evil.example'})).status, 403);
    assert.equal((await request('POST', '/quit', 'quit', {Origin: ''})).status, 403, 'no origin, not same-origin');
    assert.equal((await request('POST', '/quit', 'quit', {Origin: '', 'Sec-Fetch-Site': 'cross-site'})).status, 403);
    const exited = new Promise(ok => child.on('exit', ok));
    r = await request('POST', '/quit', 'quit', {'Content-Type': 'text/plain;charset=UTF-8'});
    assert.equal(r.status, 200); assert.match(r.text, /^Browsered launcher stopped/);
    await Promise.race([exited, new Promise((_, no) => setTimeout(() => no(new Error('the launcher did not stop')), 5000))]);
    console.log('the launcher stops on C-x C-c');
    console.log('all Codex bridge tests passed (text, images, auth, origin/host checks, cleanup; no paid API calls)');
  } finally { child.kill(); fs.rmSync(temp, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
