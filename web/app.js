// 网页版页面逻辑 —— 移植自 miniprogram/pages/index/index.js，方法名与流程保持一致。
// 页面差异仅有：
//  - Page({data, ...}) → state + render()
//  - wx.showToast → 页内 toast；wx.get/setStorageSync → localStorage
//  - wx.createWorker('workers/search.js') → new Worker('worker.js')（协议相同），
//    若浏览器不支持 Worker 则退回主线程运行同一引擎
//  - wx.getClipboardData / setClipboardData → navigator.clipboard（带降级）
//  - 分享 → navigator.share，否则复制链接（链接可直接发给 QQ / 微信好友）
const state = {
  showSettings: false,
  quickExamples: ['给我水喝', '你说吧', '你叫什么名字'],
  query: '',
  examples: ['可以给我水喝吗', '你们这里有什么吃的吗', '你也想去吗', '你说吧', '你叫什么名字', '我不给你们草'],
  editions: [],
  editionIndex: 0,
  mode: 'smart',
  loading: false,
  ready: false,
  status: '正在打开文字库…',
  results: [],
  selected: null,
  preview: '',
  whole: false,
  withVersion: false,
  template: '“{text}”（{book} {chapter}:{verse}）',
  favorites: [],
  showFavorites: false,
  count: 0
};
let conversion = null;
let formatQuote = null;
let worker = null;
let request = 0;
let loadId = 0;
let toastTimer = 0;

const $ = id => document.getElementById(id);
const queryInput = $('query');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 以 CommonJS 方式加载未改动的源码文件（engine.js / normalize.js / manifest.js / quote.js / data/*.js）
async function loadCommonJS(url) {
  const res = await fetch(url);
  if (!res.ok) throw Error('无法加载 ' + url);
  const mod = { exports: {} };
  new Function('module', 'exports', await res.text())(mod, mod.exports);
  return mod.exports;
}

function toast(text) {
  const box = $('toast');
  box.hidden = false;
  box.textContent = text;
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.remove('show');
    setTimeout(() => { box.hidden = true; }, 250);
  }, 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) { /* 降级 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  return ok;
}

function createSearchRuntime(onMessage) {
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
}

function renderList() {
  const list = state.showFavorites ? state.favorites : state.results;
  const box = $('resultList');
  if (!list.length) {
    box.innerHTML =
      '<div class="empty"><div class="quote-mark">“</div>' +
      '<div>' + (state.showFavorites ? '收藏的原句会留在这里' : '输入一句日常话，找到它的回声') + '</div>' +
      '<span class="muted">' + esc(state.showFavorites ? '选中原句，点击下方收藏' : state.status) + '</span>' +
      ((!state.ready && !state.loading) ? '<span class="link retry" id="retryBtn">重试加载</span>' : '') +
      '</div>';
    const retry = $('retryBtn');
    if (retry) retry.onclick = loadEdition;
    return;
  }
  box.innerHTML = list.map((r, i) => {
    const sel = state.selected && state.selected.key === r.key;
    return '<div class="card' + (sel ? ' selected' : '') + '" data-index="' + i + '">' +
      '<div class="row muted"><span>' + esc(r.label || '') + '</span><span>' + esc(r.versionName || '') + '</span></div>' +
      '<div class="quote">“' + esc(r.snippet || r.text || '') + '”</div>' +
      '<div class="row"><span class="reference">' + esc(r.bookName) + ' ' + r.chapter + ':' + r.verse + '</span>' +
      '<span class="link small">' + (sel ? '已选中 ✓' : '选用此句') + '</span></div>' +
      '<div class="context" data-index="' + i + '"><span class="muted">' + (r.expanded ? '收起完整经节 −' : '完整经节 ＋') + '</span>' +
      (r.expanded ? '<div class="context-text">' + esc(r.text) + '</div>' : '') + '</div></div>';
  }).join('');
}

function render() {
  const searchBtn = $('searchBtn');
  searchBtn.disabled = state.loading;
  searchBtn.textContent = state.loading ? '准备中' : '查询';
  $('editionSelect').disabled = state.loading;
  $('modeSmart').className = state.mode === 'smart' ? 'active' : '';
  $('modeExact').className = state.mode === 'exact' ? 'active' : '';
  $('resultsTitle').textContent = state.showFavorites ? '我的收藏' : '查询结果';
  $('statusText').textContent = state.loading ? '正在准备…' : (state.showFavorites ? state.favorites.length + ' 条' : state.results.length + ' 条');
  $('favToggle').textContent = state.showFavorites ? '返回查询' : '收藏';
  renderList();
  const previewBox = $('preview');
  previewBox.textContent = state.preview || '选中原句后，在这里一键复制原句与出处';
  previewBox.classList.toggle('placeholder', !state.preview);
  $('copyBtn').disabled = !state.selected || state.loading;
  $('favBtn').disabled = !state.selected;
  $('overlay').hidden = !state.showSettings;
  if (state.showSettings) {
    $('wholeSwitch').checked = state.whole;
    $('versionSwitch').checked = state.withVersion;
    const ti = $('templateInput');
    if (document.activeElement !== ti) ti.value = state.template;
  }
}

function updatePreview() {
  state.preview = state.selected ? formatQuote(state.selected, { whole: state.whole, withVersion: state.withVersion, template: state.template }) : '';
}

function loadEdition() {
  const token = ++loadId;
  request++;
  state.loading = true;
  state.ready = false;
  state.status = '正在加载文字库…';
  state.results = [];
  state.selected = null;
  state.preview = '';
  render();
  if (worker) { worker.terminate(); worker = null; }
  const m = state.editions[state.editionIndex];
  try {
    worker = createSearchRuntime(msg => {
      if (token !== loadId) return;
      if (msg.type === 'ready') {
        state.ready = true;
        state.loading = false;
        state.count = msg.count;
        state.status = '文字库已就绪 · ' + msg.count + ' 节';
        render();
        if (state.query) search();
      }
      if (msg.type === 'results' && msg.request === request) {
        const results = msg.results.map(r => ({
          ...r,
          key: r.version + '-' + r.book + '-' + r.chapter + '-' + r.verse,
          label: r.exact ? '原文命中' : r.score > 1 ? '相近表达' : '字词相关',
          expanded: false
        }));
        state.results = results;
        state.loading = false;
        state.status = results.length ? '找到 ' + results.length + ' 条回声' : '没有找到接近的原句，试试更短的关键词';
        state.selected = results[0] || null;
        updatePreview();
        render();
      }
      if (msg.type === 'error') fail(msg.message);
    });
    worker.postMessage({ type: 'init', conversion, id: m.id });
  } catch (e) {
    console.error('Library load failed', e.message, e.stack);
    if (token === loadId) fail('文字库加载失败，点击重试');
  }
}

function fail(text) {
  state.loading = false;
  state.status = text || '搜索失败，请重试';
  render();
}

function noop() {}

function toggleSettings() {
  state.showSettings = !state.showSettings;
  render();
}

function clearQuery() {
  request++;
  state.query = '';
  queryInput.value = '';
  state.results = [];
  state.selected = null;
  state.preview = '';
  state.showFavorites = false;
  state.loading = !state.ready;
  state.status = state.ready ? '输入日常话，或点击上方例句开始' : '正在准备文字库…';
  render();
}

function paste() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(r => {
      const query = (r || '').trim().slice(0, 120);
      state.query = query;
      queryInput.value = query;
      if (query && state.ready && !state.loading) search();
    }).catch(() => toast('无法读取剪贴板，可长按输入框粘贴'));
    return;
  }
  toast('无法读取剪贴板，可长按输入框粘贴');
}

function input(e) {
  state.query = e.target.value;
}

function search() {
  if (state.loading) return;
  const query = state.query.trim();
  if (!query) { toast('先写下你想说的话'); return; }
  if (!state.ready) { loadEdition(); return; }
  state.loading = true;
  state.showFavorites = false;
  state.status = '正在寻找这句话的回声…';
  state.selected = null;
  state.preview = '';
  render();
  worker.postMessage({ type: 'search', request: ++request, query, mode: state.mode });
}

function example(q) {
  if (state.loading) return;
  state.query = q;
  queryInput.value = q;
  search();
}

function changeEdition(v) {
  state.editionIndex = Number(v);
  loadEdition();
}

function changeMode(mode) {
  if (state.loading) return;
  state.mode = mode;
  render();
  if (state.query) search();
}

function select(i) {
  const list = state.showFavorites ? state.favorites : state.results;
  state.selected = list[i];
  updatePreview();
  render();
}

function context(i) {
  const field = state.showFavorites ? 'favorites' : 'results';
  state[field][i].expanded = !state[field][i].expanded;
  render();
}

function toggleWhole(checked) {
  state.whole = checked;
  updatePreview();
  render();
}

function toggleVersion(checked) {
  state.withVersion = checked;
  updatePreview();
  render();
}

function editTemplate(v) {
  state.template = v;
  updatePreview();
  render();
}

function resetTemplate() {
  state.template = '“{text}”（{book} {chapter}:{verse}）';
  $('templateInput').value = state.template;
  updatePreview();
  render();
}

function copy() {
  if (!state.preview) return;
  copyText(state.preview).then(ok => {
    if (!ok) toast('复制失败，请长按预览文字手动复制');
  });
}

function favorite() {
  const r = state.selected;
  if (!r) return;
  let favorites = state.favorites;
  const exists = favorites.some(x => x.key === r.key);
  favorites = exists ? favorites.filter(x => x.key !== r.key) : [r, ...favorites].slice(0, 100);
  try {
    localStorage.setItem('favorites', JSON.stringify(favorites));
    state.favorites = favorites;
    toast(exists ? '已取消收藏' : '已存入收藏');
  } catch (e) {
    toast('收藏保存失败');
  }
}

function toggleFavorites() {
  const show = !state.showFavorites;
  state.showFavorites = show;
  state.selected = show ? (state.favorites[0] || null) : (state.results[0] || null);
  updatePreview();
  render();
}

function about() {
  location.href = 'about.html';
}

function share() {
  const url = location.origin + location.pathname + (state.query ? '?q=' + encodeURIComponent(state.query.trim()) : '');
  if (navigator.share) {
    navigator.share({ title: '言有出处 · 日常聊天，句句有来头', url }).then(() => {}).catch(e => {
      if (e && e.name === 'AbortError') return;
      copyText(url).then(ok => toast(ok ? '链接已复制，发给朋友点开即用' : '复制失败，请手动复制地址栏链接'));
    });
    return;
  }
  copyText(url).then(ok => toast(ok ? '链接已复制，发给朋友点开即用' : '复制失败，请手动复制地址栏链接'));
}

(async function init() {
  try {
    state.editions = await loadCommonJS('manifest.js');
    conversion = await loadCommonJS('normalize.js');
    formatQuote = (await loadCommonJS('quote.js')).formatQuote;
  } catch (e) {
    console.error('Init failed', e);
    state.loading = false;
    state.status = '页面初始化失败：' + e.message;
  }
  state.editions.forEach((e, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = e.name;
    $('editionSelect').appendChild(o);
  });
  try {
    const saved = JSON.parse(localStorage.getItem('favorites') || 'null');
    state.favorites = Array.isArray(saved) ? saved : [];
  } catch (e) {
    state.favorites = [];
  }
  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    state.query = q;
    queryInput.value = q;
  }
  $('examplesBox').innerHTML = '<span class="muted">试试</span>' + state.quickExamples.map(x =>
    '<button class="example" type="button" data-q="' + esc(x) + '">' + esc(x) + '</button>').join('');
  $('examplesBox').querySelectorAll('.example').forEach(b => { b.onclick = () => example(b.dataset.q); });

  queryInput.addEventListener('input', input);
  queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  $('searchBtn').onclick = search;
  $('pasteBtn').onclick = paste;
  $('clearBtn').onclick = clearQuery;
  $('aboutBtn').onclick = about;
  $('modeSmart').onclick = () => changeMode('smart');
  $('modeExact').onclick = () => changeMode('exact');
  $('editionSelect').onchange = e => changeEdition(e.target.value);
  $('favToggle').onclick = toggleFavorites;
  $('copyBtn').onclick = copy;
  $('favBtn').onclick = favorite;
  $('settingsBtn').onclick = toggleSettings;
  $('overlay').onclick = toggleSettings;
  $('settingsBox').onclick = e => e.stopPropagation();
  $('settingsClose').onclick = toggleSettings;
  $('wholeSwitch').onchange = e => toggleWhole(e.target.checked);
  $('versionSwitch').onchange = e => toggleVersion(e.target.checked);
  $('templateInput').oninput = e => editTemplate(e.target.value);
  $('resetTpl').onclick = resetTemplate;
  $('shareBtn').onclick = share;
  $('resultList').addEventListener('click', e => {
    const ctx = e.target.closest('.context');
    if (ctx) { context(Number(ctx.dataset.index)); return; }
    const card = e.target.closest('.card');
    if (card) select(Number(card.dataset.index));
  });
  window.addEventListener('pagehide', () => { if (worker) worker.terminate(); });

  render();
  loadEdition();
})();
