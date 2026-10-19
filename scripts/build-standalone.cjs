// 构建单文件网页版：
//   node scripts/build-standalone.cjs                 → dist/verse-echo.html（全部 5 个译本，约 18 MB）
//   node scripts/build-standalone.cjs --edition cuvs  → dist/verse-echo-cuvs.html（只内置和合本简体，约 4.5 MB，适合微信/QQ 里打开）
// 把 web/ 页面与数据内联进一个 HTML，可直接作为文件发给 QQ / 微信好友，
// 对方用浏览器打开即可使用（无需联网、无需托管）。
// 检索引擎 engine.js 与文字库数据文件均原样内嵌，未做任何修改。
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web');
const read = p => fs.readFileSync(p, 'utf8');
const editions = require(path.join(web, 'manifest.js'));

// 命令行：--edition <id> 只内置指定译本（如 cuvs = 和合本简体），生成更小的文件
const argv = process.argv.slice(2);
const edArgIdx = argv.indexOf('--edition');
const slimEdition = edArgIdx >= 0 ? argv[edArgIdx + 1] : null;
const buildEditions = slimEdition ? editions.filter(e => e.id === slimEdition) : editions;
if (slimEdition && !buildEditions.length) {
  console.error('未知译本：' + slimEdition + '（可用：' + editions.map(e => e.id).join(', ') + '）');
  process.exit(1);
}

// 1) 引擎源码（原样，主线程求值使用）
const engineSrc = read(path.join(web, 'engine.js'));

// 2) 未改动的 CJS 源码文件 → 内联脚本块（IIFE 包裹，避免顶层声明泄漏到全局）
function bundleScript(name, file) {
  return '<script>\n(function () {\nwindow.__BUNDLED = window.__BUNDLED || {};\nvar module = { exports: {} };\n' +
    read(path.join(web, file)) + '\nwindow.__BUNDLED[' + JSON.stringify(name) + '] = module.exports;\n})();\n</script>';
}

// 3) 文字库数据文件 → 内联脚本块（键名与 loadCommonJS 的 URL 对齐；精简版只含指定译本）
const dataScripts = buildEditions.flatMap(ed => [0, 1, 2].map(n => bundleScript('data/' + ed.id + n, path.join('data', ed.id + n + '.js'))));

// 3b) manifest 内联：精简版只列出内置的译本（译本选择器不会出现没内置的项）
function manifestBundle() {
  if (!slimEdition) return bundleScript('manifest', 'manifest.js');
  return '<script>\n(function () {\nwindow.__BUNDLED = window.__BUNDLED || {};\nvar module = { exports: {} };\nmodule.exports=' + JSON.stringify(buildEditions) + ';\nwindow.__BUNDLED["manifest"] = module.exports;\n})();\n</script>';
}

// 4) 关于页内容（来自 web/about.html 正文）
const aboutHtml = read(path.join(web, 'about.html'));
const aboutBody = aboutHtml.split('<body>')[1].split('</body>')[0]
  .replace(/<div class="row nav">[\s\S]*?<\/div>\n?/, '')
  .replace(/<script src="about.js"><\/script>\n?/, '');

// 5) 页面逻辑：web/app.js 的三处“装载方式”替换（检索/交互逻辑不动）
let app = read(path.join(web, 'app.js'));
function replaceOnce(src, from, to, label) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error('未找到待替换片段：' + label);
  if (src.indexOf(from, i + 1) >= 0) throw new Error('片段不唯一：' + label);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

// 5.1 loadCommonJS：fetch → 内嵌资源（engine 从 text/plain 块取源码求值）
app = replaceOnce(app,
  `// 以 CommonJS 方式加载未改动的源码文件（engine.js / normalize.js / manifest.js / quote.js / data/*.js）
async function loadCommonJS(url) {
  const res = await fetch(url);
  if (!res.ok) throw Error('无法加载 ' + url);
  const mod = { exports: {} };
  new Function('module', 'exports', await res.text())(mod, mod.exports);
  return mod.exports;
}`,
  `// 单文件版：源码与数据已内联（engine.js 以 text 块原样保存）
async function loadCommonJS(url) {
  const key = String(url).replace(/\\.js$/, '');
  if (key === 'engine') {
    const mod = { exports: {} };
    new Function('module', 'exports', document.getElementById('engine-src').textContent)(mod, mod.exports);
    return mod.exports;
  }
  const bundled = window.__BUNDLED[key];
  if (!bundled) throw Error('未内置 ' + url);
  return bundled;
}`,
  'loadCommonJS');

// 5.2 整体替换 createSearchRuntime：去掉 Worker 分支，只用主线程运行同一引擎
// （微信内置浏览器等环境对 blob URL worker 支持不佳且会静默失败，主线程最稳）
app = replaceOnce(app,
`function createSearchRuntime(onMessage) {
  if (typeof Worker !== 'undefined') {
    const w = new Worker('worker.js');
    w.onerror = e => onMessage({ type: 'error', message: (e && e.message) || '后台检索启动失败' });
    w.onmessage = e => onMessage(e.data);
    return {
      postMessage: d => w.postMessage(d),
      terminate: () => { try { w.terminate(); } catch (e) {} }
    };
  }
  // 降级：主线程运行同一引擎（prepare 会短暂占用主线程）
  let engine = null;
  let dataset = null;
  let generation = 0;
  return {
    postMessage(msg) {
      if (msg.type === 'init') {
        const gen = ++generation;
        loadCommonJS('engine.js').then(eng => {
          if (gen !== generation) return null;
          engine = eng;
          return Promise.all([0, 1, 2].map(n => loadCommonJS('data/' + msg.id + n + '.js')));
        }).then(parts => {
          if (gen !== generation || !engine || !parts) return;
          engine.setConversion(msg.conversion);
          dataset = engine.prepare({ ...parts[0], verses: parts.reduce((a, c) => a.concat(c.verses), []) });
          onMessage({ type: 'ready', count: dataset.records.length });
        }).catch(e => onMessage({ type: 'error', message: e.message }));
      } else if (msg.type === 'search') {
        if (!dataset) return onMessage({ type: 'error', message: '文字库未准备好', request: msg.request });
        setTimeout(() => {
          try {
            onMessage({ type: 'results', request: msg.request, results: engine.search([dataset], msg.query, { mode: msg.mode, limit: 24 }) });
          } catch (e) { onMessage({ type: 'error', message: e.message, request: msg.request }); }
        }, 0);
      }
    },
    terminate() { generation++; dataset = null; }
  };
}`,
`// 单文件版：数据集在主线程内联合并（对应 miniprogram/utils/library.js 的合并逻辑）
async function loadLibrary(id) {
  const parts = await Promise.all([0, 1, 2].map(n => loadCommonJS('data/' + id + n)));
  return { ...parts[0], verses: parts.reduce((a, c) => a.concat(c.verses), []) };
}

// 单文件版：主线程运行同一引擎（不依赖 Worker / blob worker，兼容手机内置浏览器）
function createSearchRuntime(onMessage) {
  let engine = null;
  let dataset = null;
  let generation = 0;
  return {
    postMessage(msg) {
      if (msg.type === 'init') {
        const gen = ++generation;
        loadCommonJS('engine.js').then(eng => {
          if (gen !== generation) return null;
          engine = eng;
          return null;
        }).then(() => {
          if (gen !== generation || !engine) return;
          engine.setConversion(msg.conversion);
          dataset = engine.prepare(msg.data);
          onMessage({ type: 'ready', count: dataset.records.length });
        }).catch(e => onMessage({ type: 'error', message: e.message }));
      } else if (msg.type === 'search') {
        if (!dataset) return onMessage({ type: 'error', message: '文字库未准备好', request: msg.request });
        setTimeout(() => {
          try {
            onMessage({ type: 'results', request: msg.request, results: engine.search([dataset], msg.query, { mode: msg.mode, limit: 24 }) });
          } catch (e) { onMessage({ type: 'error', message: e.message, request: msg.request }); }
        }, 0);
      }
    },
    terminate() { generation++; dataset = null; }
  };
}`,
'去 Worker 化（仅主线程）');

// 5.3 init 消息：id → 数据本体（主线程 loadLibrary 合并后随消息传入）
app = replaceOnce(app,
  `    worker.postMessage({ type: 'init', conversion, id: m.id });`,
  `    loadLibrary(m.id).then(data => worker.postMessage({ type: 'init', conversion, data })).catch(e => {
      if (token === loadId) fail('文字库加载失败，点击重试');
    });`,
  'init 消息');



// 5.5 关于页：跳转 → 页内浮层
app = replaceOnce(app,
  `function about() {
  location.href = 'about.html';
}`,
  `function about() {
  $('aboutOverlay').hidden = false;
}
function closeAbout() {
  $('aboutOverlay').hidden = true;
}`,
  '关于入口');

// 6) 页面骨架：index.html 去掉外部引用，加入内联资源与关于浮层
let html = read(path.join(web, 'index.html'));
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read(path.join(web, 'style.css')) + '\n</style>');
html = html.replace('<script src="app.js"></script>',
  '<script id="engine-src" type="text/plain">\n' + engineSrc + '\n</script>\n' +
  bundleScript('normalize', 'normalize.js') + '\n' +
  manifestBundle() + '\n' +
  bundleScript('quote', 'quote.js') + '\n' +
  dataScripts.join('\n') + '\n' +
  '<script>\n' + app + '\n</script>');
html = html.replace('<div class="toast" id="toast" hidden></div>',
  `<div class="about-overlay" id="aboutOverlay" hidden><div class="about-sheet">${aboutBody}<div class="about-close-row"><button class="secondary" id="aboutCloseBtn" type="button">返回查询</button></div></div></div>\n<div class="toast" id="toast" hidden></div>`);
// 关于浮层的关闭与复制按钮
html = html.replace('</html>',
  '<script>\n' +
  'document.getElementById("aboutCloseBtn").onclick = function () { document.getElementById("aboutOverlay").hidden = true; };\n' +
  'document.getElementById("copySource").onclick = async function () {\n' +
  "  const url = 'https://github.com/scrollmapper/bible_databases';\n" +
  "  try { await navigator.clipboard.writeText(url); } catch (e) {\n" +
  "    const ta = document.createElement('textarea'); ta.value = url;\n" +
  "    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'; document.body.appendChild(ta); ta.select();\n" +
  "    try { document.execCommand('copy'); } catch (err) {} ta.remove();\n" +
  '  }\n' +
  '};\n' +
  '<\/script>\n</html>');

// 7) 关于浮层样式
const aboutCss = read(path.join(web, 'about.css'))
  .replace(/\.nav \{ margin-bottom: 6px; \}/, '')
  + '\n.about-overlay { position: fixed; inset: 0; z-index: 20; background: rgba(30,40,28,.45); overflow-y: auto; }\n' +
  '.about-sheet { max-width: 520px; margin: 0 auto; background: #f8f6f0; min-height: 100%; padding: 14px 17px 30px; }\n' +
  '.about-sheet .page, .about-sheet .about { padding: 0; }\n' +
  '.about-close-row { margin-top: 26px; }\n.about-close-row button { width: 100%; line-height: 41px; border-radius: 8px; }';
html = html.replace('</style>', aboutCss + '\n</style>');

// 7) 图标内嵌为 data URI（单文件版没有 assets/ 目录）
const iconDataUri = 'data:image/png;base64,' + fs.readFileSync(path.join(web, 'assets', 'icon.png')).toString('base64');
html = html.split('assets/icon.png').join(iconDataUri);

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, slimEdition ? 'verse-echo-' + slimEdition + '.html' : 'verse-echo.html');
fs.writeFileSync(out, html);
console.log('已生成', out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB' + (slimEdition ? '（仅 ' + buildEditions[0].name + '）' : '（全部 ' + buildEditions.length + ' 个译本）'));
