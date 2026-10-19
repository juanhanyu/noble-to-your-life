/* 言有出处 · 网页版
 * 与小程序 pages/index/index.js 的逻辑一一对应：同一套 engine.js 检索内核、
 * 同一份数据、同样的引用格式，只是把 WXML/WXSS 换成了 HTML/CSS，
 * 把 wx.createWorker 换成了 Web Worker（不支持时自动退化为页面内检索）。
 * 无需服务器：整站是静态文件，检索在浏览器本地完成，不上传搜索词。
 */
(function () {
  'use strict';

  var DEFAULT_TEMPLATE = '“{text}”（{book} {chapter}:{verse}）';
  var STORE_KEY = 'verse-echo.settings';
  var FAVORITES_KEY = 'verse-echo.favorites';
  var SOURCE_URL = 'https://github.com/scrollmapper/bible_databases';
  var QUICK_EXAMPLES = ['给我水喝', '你说吧', '你叫什么名字'];
  var EXAMPLES = ['可以给我水喝吗', '你们这里有什么吃的吗', '你也想去吗', '你说吧', '你叫什么名字', '我不给你们草'];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    form: $('search-form'), query: $('query'), search: $('search'), paste: $('paste'), clear: $('clear'),
    examples: $('examples'), edition: $('edition'), tabs: document.querySelector('.tabs'),
    inputTitle: $('input-title'),
    resultsTitle: $('results-title'), count: $('count'), toggleFavorites: $('toggle-favorites'),
    results: $('results'), preview: $('preview'), copy: $('copy'), favorite: $('favorite'),
    favorite2: $('favorite-2'), settingsOpen: $('settings-open'), settings: $('settings'),
    whole: $('whole'), withVersion: $('with-version'), template: $('template'),
    resetTemplate: $('reset-template'), share: $('share'), shareHint: $('share-hint'),
    aboutOpen: $('about-open'), about: $('about'), copySource: $('copy-source'), toast: $('toast')
  };

  var state = {
    editions: [], editionIndex: 0, mode: 'smart', loading: false, ready: false,
    status: '正在打开文字库…', results: [], selected: null, preview: '',
    whole: false, withVersion: false, template: DEFAULT_TEMPLATE,
    favorites: [], showFavorites: false, count: 0, conversion: {}
  };

  var searcher = null;
  var loadId = 0;
  var request = 0;
  var toastTimer = 0;
  var forceInline = false;

  /* ---------- 小工具 ---------- */

  function toast(text) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 1800);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatQuote(r) {
    var fields = {
      text: state.whole ? r.text : r.snippet,
      book: r.bookName, chapter: r.chapter, verse: r.verse, version: r.versionName
    };
    return state.template.replace(/\{(text|book|chapter|verse|version)\}/g, function (_, k) {
      return fields[k];
    }) + (state.withVersion && state.template.indexOf('{version}') < 0 ? '〔' + r.versionName + '〕' : '');
  }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        editionIndex: state.editionIndex, mode: state.mode, whole: state.whole,
        withVersion: state.withVersion, template: state.template
      }));
    } catch (e) { /* 隐私模式下可能不可写，忽略 */ }
  }

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites)); } catch (e) {}
  }

  async function fetchJson(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      try {
        var res = await fetch(candidates[i], { cache: 'force-cache' });
        if (res.ok) return res.json();
      } catch (e) { /* 继续尝试下一个路径 */ }
    }
    throw Error('无法读取 ' + candidates[0]);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = function () { reject(Error('无法加载 ' + src)); };
      document.head.appendChild(tag);
    });
  }

  /* ---------- 检索引擎（Worker，或页面内兜底） ---------- */

  function createSearcher(onMessage) {
    var worker = null;
    if (!forceInline && typeof Worker !== 'undefined') {
      try {
        worker = new Worker('search-worker.js');
        worker.onmessage = function (event) { onMessage(event.data); };
        return {
          worker: worker,
          post: function (m) { worker.postMessage(m); },
          terminate: function () { worker.terminate(); }
        };
      } catch (e) { worker = null; }
    }
    // 兜底：在页面内加载同一套脚本，消息格式完全一致
    return {
      worker: null,
      post: function (m) { window.handleSearchMessage(m, onMessage); },
      terminate: function () {}
    };
  }

  async function fallbackToInlineEngine() {
    if (window.handleSearchMessage) return true;
    window.module = { exports: {} };
    await loadScript('library.js');
    await loadScript('engine.js');
    await loadScript('search-core.js');
    return !!window.handleSearchMessage;
  }

  function onSearcherMessage(msg) {
    if (msg.type === 'ready' && msg.token === loadId && msg.id === currentEditionId()) {
      setLoading(false);
      state.ready = true;
      state.count = msg.count;
      state.status = '文字库已就绪 · ' + msg.count + ' 节';
      render();
      if (state.query.trim()) search();
      return;
    }
    if (msg.type === 'results' && msg.request === request) {
      state.results = msg.results.map(function (r) {
        return Object.assign({}, r, {
          key: r.version + '-' + r.book + '-' + r.chapter + '-' + r.verse,
          label: r.exact ? '原文命中' : r.score > 1 ? '相近表达' : '字词相关',
          expanded: false
        });
      });
      setLoading(false);
      state.selected = state.results[0] || null;
      state.status = state.results.length ? '找到 ' + state.results.length + ' 条回声' : '没有找到接近的原句，试试更短的关键词';
      renderPreview();
      render();
      return;
    }
    if (msg.type === 'error') {
      fail(msg.message);
    }
  }

  function currentEditionId() {
    return state.editions[state.editionIndex] ? state.editions[state.editionIndex].id : '';
  }

  function setLoading(value) {
    state.loading = value;
    el.search.disabled = value;
    el.search.textContent = value ? '准备中' : '查询';
    el.edition.disabled = !!value;
  }

  function fail(text) {
    setLoading(false);
    state.ready = false;
    state.status = text || '搜索失败，请重试';
    render();
  }

  /* ---------- 版本加载 ---------- */

  function loadEdition() {
    var token = ++loadId;
    request++;
    setLoading(true);
    state.ready = false;
    state.status = '正在加载文字库…';
    state.results = [];
    state.selected = null;
    state.preview = '';
    render();
    searcher.post({ type: 'load', id: currentEditionId(), token: token, conversion: state.conversion });
    return token;
  }

  /* ---------- 检索 ---------- */

  function search() {
    if (state.loading) return;
    var query = state.query.trim();
    if (!query) { toast('先写下你想说的话'); return; }
    if (!state.ready) { loadEdition(); return; }
    setLoading(true);
    state.showFavorites = false;
    state.status = '正在寻找这句话的回声…';
    state.selected = null;
    state.preview = '';
    render();
    searcher.post({ type: 'search', request: ++request, query: query, mode: state.mode });
    syncUrl(query);
  }

  function syncUrl(query) {
    try {
      var url = new URL(window.location.href);
      if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
      if (url.toString() !== window.location.href) window.history.replaceState(null, '', url.toString());
    } catch (e) { /* file:// 等场景忽略 */ }
  }

  function shareUrl() {
    var url = window.location.href.split('#')[0].split('?')[0];
    return url + (state.query.trim() ? '?q=' + encodeURIComponent(state.query.trim()) : '');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 继续用兜底方案 */ }
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 渲染 ---------- */

  function renderExamples() {
    el.examples.innerHTML = EXAMPLES.map(function (q) {
      return '<button type="button" class="example" data-q="' + escapeHtml(q) + '">' + escapeHtml(q) + '</button>';
    }).join('');
  }

  function renderEditions() {
    el.edition.innerHTML = state.editions.map(function (m, i) {
      return '<option value="' + i + '"' + (i === state.editionIndex ? ' selected' : '') + '>' + escapeHtml(m.name) + '</option>';
    }).join('');
  }

  function cardHtml(item, index) {
    var selected = state.selected && state.selected.key === item.key;
    return '<article class="card' + (selected ? ' selected' : '') + '" data-index="' + index + '">' +
      '<div class="row muted"><span>' + escapeHtml(item.label) + '</span><span>' + escapeHtml(item.versionName) + '</span></div>' +
      '<div class="quote">“' + escapeHtml(item.snippet) + '”</div>' +
      '<div class="row"><span class="reference">' + escapeHtml(item.bookName) + ' ' + item.chapter + ':' + item.verse + '</span>' +
      '<span class="link small">' + (selected ? '已选中 ✓' : '选用此句') + '</span></div>' +
      '<div class="context" data-context="' + index + '"><span class="muted">' + (item.expanded ? '收起完整经节 −' : '完整经节 ＋') + '</span>' +
      (item.expanded ? '<div class="context-text">' + escapeHtml(item.text) + '</div>' : '') + '</div>' +
      '</article>';
  }

  function renderResults() {
    var list = state.showFavorites ? state.favorites : state.results;
    if (!list.length) {
      el.results.innerHTML = '<div class="empty"><div class="quote-mark">“</div>' +
        '<div>' + (state.showFavorites ? '收藏的原句会留在这里' : '输入一句日常话，找到它的回声') + '</div>' +
        '<span class="muted">' + (state.showFavorites ? '选中原句，点击下方收藏' : escapeHtml(state.status)) + '</span>' +
        (!state.ready && !state.loading ? '<span class="link retry" id="retry">重试加载</span>' : '') +
        '</div>';
      var retry = $('retry');
      if (retry) retry.addEventListener('click', loadEdition);
      return;
    }
    el.results.innerHTML = list.map(cardHtml).join('');
  }

  function renderPreview() {
    state.preview = state.selected ? formatQuote(state.selected) : '';
    if (state.preview) {
      el.preview.textContent = state.preview;
      el.preview.classList.remove('placeholder');
    } else {
      el.preview.textContent = '选中原句后，在这里一键复制原句与出处';
      el.preview.classList.add('placeholder');
    }
    var has = !!state.selected;
    el.copy.disabled = !has || state.loading;
    el.favorite.disabled = !has;
    el.favorite2.disabled = !has;
    var fav = has && state.favorites.some(function (x) { return x.key === state.selected.key; });
    el.favorite.textContent = fav ? '取消收藏' : '收藏';
    el.favorite2.textContent = el.favorite.textContent;
  }

  function render() {
    Array.prototype.forEach.call(el.tabs.children, function (tab) {
      tab.classList.toggle('active', tab.dataset.mode === state.mode);
    });
    el.query.value = state.query;
    el.edition.value = String(state.editionIndex);
    el.resultsTitle.textContent = state.showFavorites ? '我的收藏' : '查询结果';
    el.toggleFavorites.textContent = state.showFavorites ? '返回查询' : '收藏';
    el.count.textContent = state.loading ? '正在准备…'
      : (state.showFavorites ? state.favorites.length + ' 条' : state.results.length + ' 条');
    el.whole.checked = state.whole;
    el.withVersion.checked = state.withVersion;
    if (el.template.value !== state.template) el.template.value = state.template;
    renderResults();
    renderPreview();
  }

  /* ---------- 事件 ---------- */

  function bind() {
    el.form.addEventListener('submit', function (event) {
      event.preventDefault();
      search();
    });

    el.query.addEventListener('input', function () {
      state.query = el.query.value;
    });

    el.paste.addEventListener('click', async function () {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) throw Error('unsupported');
        var text = (await navigator.clipboard.readText() || '').trim().slice(0, 120);
        if (!text) { toast('剪贴板是空的'); return; }
        state.query = text;
        el.query.value = text;
        if (state.ready && !state.loading) search(); else render();
      } catch (e) {
        toast('无法读取剪贴板，请长按输入框粘贴');
        el.query.focus();
      }
    });

    el.clear.addEventListener('click', function () {
      request++;
      state.query = '';
      state.results = [];
      state.selected = null;
      state.preview = '';
      state.showFavorites = false;
      setLoading(!state.ready);
      state.status = state.ready ? '输入日常话，或点击上方例句开始' : '正在准备文字库…';
      syncUrl('');
      render();
    });

    el.examples.addEventListener('click', function (event) {
      var button = event.target.closest('.example');
      if (!button || state.loading) return;
      state.query = button.dataset.q;
      el.query.value = state.query;
      search();
    });

    el.tabs.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-mode]');
      if (!tab || state.loading) return;
      state.mode = tab.dataset.mode;
      saveStore();
      if (state.query.trim()) search(); else render();
    });

    el.edition.addEventListener('change', function () {
      state.editionIndex = Number(el.edition.value) || 0;
      saveStore();
      loadEdition();
    });

    el.results.addEventListener('click', function (event) {
      var context = event.target.closest('[data-context]');
      var card = event.target.closest('.card');
      if (!card) return;
      var list = state.showFavorites ? state.favorites : state.results;
      var index = Number(card.dataset.index);
      if (context) {
        list[index].expanded = !list[index].expanded;
      } else {
        state.selected = list[index];
      }
      renderPreview();
      renderResults();
    });

    el.copy.addEventListener('click', async function () {
      if (!state.preview) return;
      var ok = await copyText(state.preview);
      toast(ok ? '已复制原句与出处' : '复制失败，请长按预览文字手动复制');
    });

    function favorite() {
      var r = state.selected;
      if (!r) return;
      var exists = state.favorites.some(function (x) { return x.key === r.key; });
      state.favorites = exists
        ? state.favorites.filter(function (x) { return x.key !== r.key; })
        : [r].concat(state.favorites).slice(0, 100);
      saveFavorites();
      toast(exists ? '已取消收藏' : '已存入收藏');
      renderPreview();
      if (state.showFavorites) renderResults();
    }

    el.favorite.addEventListener('click', favorite);
    el.favorite2.addEventListener('click', favorite);

    el.toggleFavorites.addEventListener('click', function () {
      state.showFavorites = !state.showFavorites;
      state.selected = state.showFavorites ? (state.favorites[0] || null) : (state.results[0] || null);
      render();
    });

    function openSheet(node) { node.hidden = false; }
    function closeSheet(node) { node.hidden = true; }

    el.settingsOpen.addEventListener('click', function () { openSheet(el.settings); });
    el.aboutOpen.addEventListener('click', function () { openSheet(el.about); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (node) {
      node.addEventListener('click', function () {
        var target = node.dataset.close;
        closeSheet(target === 'about' ? el.about : el.settings);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.overlay'), function (node) {
      node.addEventListener('click', function (event) {
        if (event.target === node) node.hidden = true;
      });
    });

    el.whole.addEventListener('change', function () { state.whole = el.whole.checked; saveStore(); renderPreview(); });
    el.withVersion.addEventListener('change', function () { state.withVersion = el.withVersion.checked; saveStore(); renderPreview(); });
    el.template.addEventListener('input', function () { state.template = el.template.value; renderPreview(); });
    el.resetTemplate.addEventListener('click', function () { state.template = DEFAULT_TEMPLATE; saveStore(); renderPreview(); render(); });

    el.share.addEventListener('click', async function () {
      var url = shareUrl();
      var text = state.preview || '言有出处 · 日常话，早有出处';
      if (navigator.share) {
        try {
          await navigator.share({ title: '言有出处', text: text, url: url });
          return;
        } catch (e) { /* 用户取消或不支持，转为复制 */ }
      }
      var ok = await copyText(url);
      el.shareHint.textContent = ok
        ? '链接已复制，粘贴到微信或 QQ 发给好友即可。'
        : '请长按地址栏复制本页链接：' + url;
    });

    el.copySource.addEventListener('click', async function () {
      var ok = await copyText(SOURCE_URL);
      toast(ok ? '已复制数据来源链接' : SOURCE_URL);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { el.settings.hidden = true; el.about.hidden = true; }
    });
  }

  /* ---------- 启动 ---------- */

  async function start() {
    var saved = readStore();
    if (saved && typeof saved === 'object') {
      state.whole = !!saved.whole;
      state.withVersion = !!saved.withVersion;
      state.mode = saved.mode === 'exact' ? 'exact' : 'smart';
      state.template = typeof saved.template === 'string' && saved.template ? saved.template : DEFAULT_TEMPLATE;
      state.editionIndex = Number(saved.editionIndex) || 0;
    }
    try {
      state.favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      if (!Array.isArray(state.favorites)) state.favorites = [];
    } catch (e) { state.favorites = []; }

    var params = new URLSearchParams(window.location.search);
    var shared = params.get('q') || '';
    if (shared) {
      state.query = shared.slice(0, 120);
      el.inputTitle.textContent = '好友分享的这句话';
    }

    bind();
    renderExamples();
    render();

    try {
      state.editions = await fetchJson(['../miniprogram/manifest.json', 'manifest.json']);
      state.conversion = await fetchJson(['../miniprogram/normalize.json', 'normalize.json']);
    } catch (e) {
      fail('文字清单加载失败，请检查文件是否完整');
      return;
    }
    if (state.editionIndex >= state.editions.length) state.editionIndex = 0;
    renderEditions();
    render();

    searcher = createSearcher(onSearcherMessage);
    if (!searcher.worker) {
      try {
        await fallbackToInlineEngine();
      } catch (e) {
        fail('检索脚本加载失败，请通过网页服务器打开（不要双击文件直接打开）');
        return;
      }
    } else {
      searcher.worker.onerror = async function () {
        if (state.ready) return;
        try {
          await fallbackToInlineEngine();
          searcher = createSearcher(onSearcherMessage);
          loadEdition();
        } catch (err) {
          fail('检索脚本加载失败，请通过网页服务器打开');
        }
      };
    }
    loadEdition();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
