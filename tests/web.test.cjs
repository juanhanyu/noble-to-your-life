const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'web');
const miniprogram = path.join(root, 'miniprogram');
const manifest = JSON.parse(fs.readFileSync(path.join(web, 'manifest.json'), 'utf8'));
const conversion = JSON.parse(fs.readFileSync(path.join(web, 'normalize.json'), 'utf8'));

// 把相对 URL 映射到仓库里的真实文件：'../miniprogram/...' 指向小程序数据，'data/...' 指向独立部署副本
function fileResponse(url) {
  const relative = String(url).replace(/^\.\.\//, '');
  const file = String(url).startsWith('../')
    ? path.join(root, relative)
    : path.join(web, String(url));
  return {
    ok: fs.existsSync(file),
    status: fs.existsSync(file) ? 200 : 404,
    text: async () => fs.readFileSync(file, 'utf8'),
    json: async () => JSON.parse(fs.readFileSync(file, 'utf8'))
  };
}

// workerScripts=false 时模拟没有 importScripts 的环境（页面内兜底走的 new Function 路径）
function createContext({ workerScripts = true } = {}) {
  const posted = [];
  const blobs = new Map();
  const run = (code, filename) => vm.runInContext(code, sandbox, { filename });
  const sandbox = {
    console,
    Promise,
    setTimeout,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    fetch: async (url) => fileResponse(url),
    postMessage: (message) => posted.push(message),
    // 供 library.js 生成 blob 用（浏览器里是原生 URL/Blob）
    Blob: class Blob {
      constructor(parts) { this.text = parts.join(''); }
    },
    URL: class FakeURL {
      static createObjectURL(blob) {
        const url = 'blob:test/' + blobs.size;
        blobs.set(url, blob.text);
        return url;
      }
      static revokeObjectURL(url) { blobs.delete(url); }
    },
    importScripts: workerScripts
      ? (...files) => {
        for (const file of files) {
          const key = String(file);
          if (key.startsWith('blob:')) run(blobs.get(key), key);
          else run(fs.readFileSync(path.join(web, key), 'utf8'), key);
        }
      }
      : undefined
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.module = { exports: {} }; // 供未修改的 engine.js 使用
  vm.createContext(sandbox);
  return { sandbox, posted };
}

test('网页版直接读取小程序分包数据，五个版本经节数与 manifest 一致', async () => {
  const { sandbox, posted } = createContext({ workerScripts: false });
  vm.runInContext(fs.readFileSync(path.join(web, 'library.js'), 'utf8'), sandbox, { filename: 'library.js' });
  vm.runInContext(fs.readFileSync(path.join(web, 'engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });
  vm.runInContext(fs.readFileSync(path.join(web, 'search-core.js'), 'utf8'), sandbox, { filename: 'search-core.js' });
  assert.equal(typeof sandbox.loadLibrary, 'function');
  assert.equal(typeof sandbox.handleSearchMessage, 'function');

  for (const m of manifest) {
    const messages = [];
    await sandbox.handleSearchMessage({ type: 'load', id: m.id, token: 1, conversion }, (msg) => messages.push(msg));
    const ready = messages.pop();
    assert.equal(ready.type, 'ready', m.id);
    assert.equal(ready.id, m.id);
    assert.equal(ready.token, 1);
    assert.equal(ready.count, m.count, m.id);
  }
  assert.equal(posted.length, 0);
});

test('检索线程（search-worker.js）复用同一内核，命中的出处与论坛例句一致', async () => {
  const { sandbox, posted } = createContext();
  vm.runInContext(fs.readFileSync(path.join(web, 'search-worker.js'), 'utf8'), sandbox, { filename: 'search-worker.js' });
  const send = (message) => sandbox.onmessage({ data: message });

  send({ type: 'load', id: 'cuvs', token: 7, conversion });
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (!posted.some((m) => m.type === 'ready')) await new Promise((resolve) => setTimeout(resolve, 20));
  const ready = posted.find((m) => m.type === 'ready');
  assert.equal(ready.count, manifest[0].count);
  assert.equal(ready.token, 7);

  for (const [query, book, chapter, verse] of [
    ['可以给我水喝吗', 43, 4, 7],
    ['你们这里有什么吃的吗', 42, 24, 41],
    ['你也想去吗', 43, 6, 67],
    ['你手里拿的是什么', 2, 4, 2]
  ]) {
    send({ type: 'search', request: 11, query, mode: 'smart' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const message = posted.filter((m) => m.type === 'results').pop();
    assert.equal(message.request, 11);
    assert.ok(message.results.length > 0, query);
    assert.ok(message.results.slice(0, 5).some((r) => r.book === book && r.chapter === chapter && r.verse === verse), query);
    for (const r of message.results) assert.ok(r.text.includes(r.snippet));
  }

  send({ type: 'search', request: 12, query: '约翰福音 4:7', mode: 'smart' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reference = posted.filter((m) => m.type === 'results').pop();
  assert.equal(reference.results.length, 1);
  assert.equal(reference.results[0].bookName, '约翰福音');
});

test('网页版资源完整：脚本可解析、引用的元素与文件都存在', () => {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
  new vm.Script(app, { filename: 'app.js' });

  for (const file of ['app.css', 'app.js', 'icon.png', 'manifest.json', 'normalize.json', 'library.js', 'engine.js', 'search-core.js', 'search-worker.js']) {
    assert.ok(fs.existsSync(path.join(web, file)), file);
  }
  assert.equal(fs.readFileSync(path.join(web, 'engine.js'), 'utf8'), fs.readFileSync(path.join(miniprogram, 'workers/engine.js'), 'utf8'), 'engine.js 应与小程序保持一致');

  const dynamic = new Set(['retry']); // 由 renderResults() 生成
  for (const match of app.matchAll(/\$\('([\w-]+)'\)/g)) {
    if (dynamic.has(match[1])) continue;
    assert.ok(html.includes('id="' + match[1] + '"'), 'index.html 缺少 ' + match[1]);
  }
  for (const match of html.matchAll(/(?:src|href)="([^"#][^":]*?\.[\w]+)"/g)) {
    assert.ok(fs.existsSync(path.join(web, match[1])), 'index.html 引用了缺失文件 ' + match[1]);
  }
  for (const match of fs.readFileSync(path.join(web, 'search-worker.js'), 'utf8').matchAll(/importScripts\(([^)]+)\)/g)) {
    for (const file of match[1].matchAll(/'([\w.-]+)'/g)) {
      assert.ok(fs.existsSync(path.join(web, file[1])), 'worker 引用了缺失文件 ' + file[1]);
    }
  }
});
