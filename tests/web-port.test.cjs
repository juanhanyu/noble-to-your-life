// 网页版移植验证：
// 1) 在模拟 Worker 环境中真实执行 web/worker.js（importScripts + module 垫片），
//    覆盖全部 5 个译本加载、检索（精确/相近/经节定位/原文包含模式）；
// 2) 校验 web/ 下复用的源码文件与 miniprogram/ 原件逐字节一致；
// 3) 编译检查 web/app.js 与 web/about.js 语法。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeWorkerEnv() {
  const sandbox = { console, setTimeout, clearTimeout };
  const queue = [];
  sandbox.self = { onmessage: null, postMessage(m) { queue.push(m); } };
  sandbox.importScripts = url => {
    const code = fs.readFileSync(path.join(web, url), 'utf8');
    vm.runInContext(code, sandbox, { filename: url });
  };
  vm.createContext(sandbox);
  return { sandbox, queue };
}

function bootWorker(env, editionId, conversion) {
  vm.runInContext(fs.readFileSync(path.join(web, 'worker.js'), 'utf8'), env.sandbox, { filename: 'worker.js' });
  env.queue.length = 0;
  env.sandbox.self.onmessage({ type: 'init', id: editionId, conversion });
  return env.queue[0];
}

function search(env, query, mode, request) {
  env.queue.length = 0;
  env.sandbox.self.onmessage({ type: 'search', request, query, mode });
  const msg = env.queue[0];
  assert.ok(msg, 'worker 无响应');
  if (msg.type === 'error') throw new Error(msg.message);
  assert.strictEqual(msg.type, 'results');
  return msg.results;
}

test('web/ 复用的源码文件与 miniprogram/ 原件一致', () => {
  const pairs = [
    ['miniprogram/workers/engine.js', 'web/engine.js'],
    ['miniprogram/normalize.js', 'web/normalize.js'],
    ['miniprogram/manifest.js', 'web/manifest.js'],
    ['miniprogram/utils/quote.js', 'web/quote.js'],
    ...['cuvs', 'cuvt', 'wenli', 'asv', 'kjv'].flatMap(v => [0, 1, 2].map(n => [`miniprogram/library/${v}${n}/data.js`, `web/data/${v}${n}.js`]))
  ];
  for (const [a, b] of pairs) {
    assert.strictEqual(sha(path.join(root, a)), sha(path.join(root, b)), a + ' 应与 ' + b + ' 一致');
  }
});

test('worker.js 在模拟 Worker 环境加载并检索全部五个译本', { timeout: 120000 }, t => {
  const conversion = require(path.join(root, 'miniprogram/normalize.js'));
  const manifest = require(path.join(root, 'miniprogram/manifest.json'));
  for (const ed of manifest) {
    const env = makeWorkerEnv();
    const ready = bootWorker(env, ed.id, conversion);
    assert.strictEqual(ready.type, 'ready', ed.id + ' 应返回 ready');
    assert.strictEqual(ready.count, ed.count, ed.id + ' 经节数应为 ' + ed.count);
    console.log(`  ${ed.id}: ready, ${ready.count} verses`);
  }
});

test('cuvs 检索行为与小程序一致', { timeout: 120000 }, t => {
  const conversion = require(path.join(root, 'miniprogram/normalize.js'));
  const env = makeWorkerEnv();
  const ready = bootWorker(env, 'cuvs', conversion);
  assert.strictEqual(ready.type, 'ready');
  assert.strictEqual(ready.count, 31103);

  let r = search(env, '给我水喝', 'smart', 1);
  assert.ok(r.length > 0);
  assert.ok(r.some(x => x.bookName === '约翰福音' && x.chapter === 4 && x.verse === 10 && x.exact));

  r = search(env, '我不给你们草', 'smart', 2);
  assert.strictEqual(r[0].bookName, '出埃及记');
  assert.strictEqual(r[0].verse, 10);
  assert.strictEqual(r[0].exact, true);

  r = search(env, '约翰福音 4:7', 'smart', 3);
  assert.strictEqual(r[0].bookName, '约翰福音');
  assert.strictEqual(r[0].chapter, 4);
  assert.strictEqual(r[0].verse, 7);
  assert.strictEqual(r[0].score, 10);

  r = search(env, '给我水喝', 'exact', 4);
  assert.ok(r.every(x => x.exact));

  r = search(env, '你叫什么名字', 'smart', 5);
  assert.ok(r.length > 0);

  // 错误分支：未初始化
  const env2 = makeWorkerEnv();
  vm.runInContext(fs.readFileSync(path.join(web, 'worker.js'), 'utf8'), env2.sandbox, { filename: 'worker.js' });
  env2.queue.length = 0;
  env2.sandbox.self.onmessage({ type: 'search', request: 1, query: '给我水喝', mode: 'smart' });
  assert.strictEqual(env2.queue[0].type, 'error');
});

test('quote.js 的 formatQuote 与页面引用模板一致', () => {
  const { formatQuote } = require(path.join(root, 'web/quote.js'));
  const r = { text: '请你给我水喝。', snippet: '给我水喝', bookName: '约翰福音', chapter: 4, verse: 7, versionName: '和合本 · 简体' };
  assert.strictEqual(formatQuote(r, { template: '“{text}”（{book} {chapter}:{verse}）' }), '“给我水喝”（约翰福音 4:7）');
  assert.strictEqual(formatQuote(r, { whole: true, withVersion: true }), '“请你给我水喝。”（约翰福音 4:7）〔和合本 · 简体〕');
});

test('app.js / about.js / index.html / about.html 语法与结构检查', () => {
  vm.compileFunction(fs.readFileSync(path.join(web, 'app.js'), 'utf8'));
  vm.compileFunction(fs.readFileSync(path.join(web, 'about.js'), 'utf8'));
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  for (const id of ['query', 'searchBtn', 'pasteBtn', 'clearBtn', 'aboutBtn', 'modeSmart', 'modeExact', 'editionSelect', 'resultsTitle', 'statusText', 'favToggle', 'resultList', 'preview', 'copyBtn', 'favBtn', 'settingsBtn', 'overlay', 'settingsBox', 'settingsClose', 'wholeSwitch', 'versionSwitch', 'templateInput', 'resetTpl', 'shareBtn', 'examplesBox', 'toast']) {
    assert.ok(html.includes(`id="${id}"`), 'index.html 缺少 #' + id);
  }
  assert.ok(html.includes('app.js'));
  assert.ok(fs.existsSync(path.join(web, 'worker.js')));
  assert.ok(fs.existsSync(path.join(web, 'assets/icon.png')));
  assert.ok(fs.existsSync(path.join(root, 'index.html')));
});
