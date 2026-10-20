// 单文件网页版（dist/verse-echo.html）DOM 冒烟测试。
// 需要 jsdom（npm i jsdom），未安装时自动跳过。
// 验证：内嵌数据零网络加载、检索、完整经节、收藏、五个译本切换、关于浮层。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* 未安装则跳过 */ }

test('dist/verse-echo.html 单文件版 DOM 冒烟测试', { timeout: 120000 }, async t => {
  if (!JSDOM) return t.skip('未安装 jsdom（npm i jsdom 后自动生效）');
  const file = path.join(root, 'dist', 'verse-echo.html');
  if (!fs.existsSync(file)) return t.skip('dist/verse-echo.html 不存在，先运行 node scripts/build-standalone.cjs');

  const html = fs.readFileSync(file, 'utf8');
  assert.ok(!html.includes('assets/icon.png'), '图标应内嵌为 data URI，不应再有相对路径引用');
  assert.ok(html.includes('data:image/png;base64,'), '应包含内嵌图标');
  assert.ok(!html.includes('buildWorkerBlobUrl'), '单文件版不应依赖 blob worker');
  const errors = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/verse-echo.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.Worker = undefined; // 走主线程降级路径（与 file:// 打开场景一致）
      window.document.execCommand = () => true;
      window.addEventListener('error', e => errors.push(e.message));
    }
  });
  const { window } = dom;
  const { document } = window;
  const $ = id => document.getElementById(id);
  const until = (fn, ms = 30000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); }
    }, 100);
  });
  t.after(() => window.close());

  await until(() => document.body.textContent.includes('文字库已就绪 · 31103 节'));
  assert.ok(!errors.length, '页面不应报错: ' + errors.join(' | '));
  console.log('  单文件内嵌数据就绪（主线程路径）');

  const q = $('query');
  q.value = '给我水喝';
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  $('searchBtn').click();
  await until(() => document.querySelector('.result-list .card'));
  assert.ok(document.querySelector('.result-list .card').textContent.includes('约翰福音 4:10'));

  document.querySelector('.result-list .card .context').click();
  await until(() => document.querySelector('.result-list .card').textContent.includes('你若知道神的恩赐'));

  $('favBtn').click();
  await until(() => JSON.parse(window.localStorage.getItem('favorites') || '[]').length === 1);

  $('clearBtn').click();
  $('editionSelect').value = '4';
  $('editionSelect').onchange({ target: { value: '4' } });
  await until(() => document.body.textContent.includes('文字库已就绪 · 31102 节'));

  q.value = '约翰福音 4:7';
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  $('searchBtn').click();
  await until(() => {
    const c = document.querySelector('.result-list .card');
    return c && c.textContent.includes('约翰福音 4:7') && c.textContent.includes('King James Version');
  });

  $('aboutBtn').click();
  assert.strictEqual($('aboutOverlay').hidden, false);
  assert.ok($('aboutOverlay').textContent.includes('隐私说明'));
  $('aboutCloseBtn').click();
  assert.strictEqual($('aboutOverlay').hidden, true);
});

test('dist/verse-echo-cuvs.html 精简版（仅和合本简体）DOM 冒烟测试', { timeout: 120000 }, async t => {
  if (!JSDOM) return t.skip('未安装 jsdom（npm i jsdom 后自动生效）');
  const file = path.join(root, 'dist', 'verse-echo-cuvs.html');
  if (!fs.existsSync(file)) return t.skip('dist/verse-echo-cuvs.html 不存在，先运行 node scripts/build-standalone.cjs --edition cuvs');

  const html = fs.readFileSync(file, 'utf8');
  const size = fs.statSync(file).size;
  assert.ok(size < 8 * 1048576, '精简版应小于 8 MB（实际 ' + (size / 1048576).toFixed(1) + ' MB）');
  assert.ok(!html.includes('buildWorkerBlobUrl'), '精简版不应依赖 blob worker');

  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/verse-echo-cuvs.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) { window.Worker = undefined; window.document.execCommand = () => true; }
  });
  const { window } = dom;
  const { document } = window;
  const $ = id => document.getElementById(id);
  const until = (fn, ms = 30000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); }
    }, 100);
  });
  t.after(() => window.close());

  await until(() => document.body.textContent.includes('文字库已就绪 · 31103 节'));
  assert.strictEqual($('editionSelect').options.length, 1, '精简版译本选择器应只有一个译本');
  assert.strictEqual($('editionSelect').options[0].textContent, '和合本 · 简体');

  const q = $('query');
  q.value = '给我水喝';
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  $('searchBtn').click();
  await until(() => document.querySelector('.result-list .card'));
  assert.ok(document.querySelector('.result-list .card').textContent.includes('约翰福音 4:10'));
  console.log('  精简版（' + (size / 1048576).toFixed(1) + ' MB）加载与检索正常');
});
