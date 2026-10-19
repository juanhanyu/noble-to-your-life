/* =========================================================
 * 书里 ShuLi —— 这句话出自哪本书？
 * 纯前端单页应用：精确匹配 + 模糊匹配（编辑距离）
 * ========================================================= */
(function () {
  "use strict";

  /* ---------------- 工具 ---------------- */
  var LS_CUSTOM = "shuli.custom.v1";
  var LS_LIBS = "shuli.libs.v1";

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 归一化：全角转半角、去标点空格、小写；保留原文字符位置映射用于高亮
  function norm(s) {
    var out = "", map = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], code = s.charCodeAt(i);
      if (code >= 0xff01 && code <= 0xff5e) ch = String.fromCharCode(code - 0xfee0);
      if (/[a-z]/.test(ch) === false && /[A-Z]/.test(ch)) ch = ch.toLowerCase();
      if (/[\u3400-\u4dbf\u4e00-\u9fff0-9a-z]/.test(ch)) { out += ch; map.push(i); }
    }
    return { n: out, map: map };
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (var k = 1; k <= n; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  /* ---------------- 书库 ---------------- */
  // 条目: { t, b, c, a, note?, src? }  src: "builtin" | "custom" | lib名
  var custom = loadJSON(LS_CUSTOM, []);
  var remoteLibs = loadJSON(LS_LIBS, []); // [{name, url, quotes:[...]}]

  function loadJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 存储满时忽略 */ } }

  function buildCorpus() {
    var byKey = Object.create(null);
    var order = [];
    function push(q, src) {
      if (!q || typeof q.t !== "string" || !q.t.trim()) return;
      var key = norm(q.t).n;
      if (!key) return;
      if (byKey[key]) { byKey[key] = q; return; } // 后加载的覆盖（自定义优先）
      byKey[key] = q; order.push(key);
    }
    (window.BUILTIN_QUOTES || []).forEach(function (q) { push(q, "builtin"); });
    remoteLibs.forEach(function (lib) { (lib.quotes || []).forEach(function (q) { push(q, lib.name); }); });
    custom.forEach(function (q) { push(q, "custom"); });
    return order.map(function (k) { return byKey[k]; });
  }

  var corpus = buildCorpus();
  var index = corpus.map(function (e) { var r = norm(e.t); return { e: e, n: r.n, map: r.map }; });

  function stats() {
    var c = 0;
    custom.forEach(function () { c++; });
    var r = 0; remoteLibs.forEach(function (l) { r += (l.quotes || []).length; });
    return { total: index.length, custom: custom.length, remote: r, builtin: index.length - c - r };
  }

  /* ---------------- 检索 ---------------- */
  var FUZZY_MIN = 4, FUZZY_THRESHOLD = 0.62;

  function search(rawQ) {
    var q = (rawQ || "").trim();
    if (!q) return null;
    var qn = norm(q).n;
    var exact = [], fuzzy = [];
    if (qn.length >= 2) {
      for (var i = 0; i < index.length; i++) {
        var pos = index[i].n.indexOf(qn);
        if (pos >= 0) exact.push({ e: index[i].e, pos: pos, len: qn.length, ratio: 1 });
      }
    }
    if (exact.length === 0 && qn.length >= FUZZY_MIN) {
      for (var j = 0; j < index.length; j++) {
        var it = index[j], best = 0, bestPos = 0;
        if (it.n.length >= qn.length) {
          for (var s = 0; s + qn.length <= it.n.length; s++) {
            var d = levenshtein(it.n.substr(s, qn.length), qn);
            var r = 1 - d / qn.length;
            if (r > best) { best = r; bestPos = s; }
          }
        } else {
          best = 1 - levenshtein(it.n, qn) / qn.length; bestPos = 0;
        }
        if (best >= FUZZY_THRESHOLD) fuzzy.push({ e: it.e, pos: bestPos, len: Math.min(qn.length, it.n.length), ratio: best });
      }
      fuzzy.sort(function (a, b) { return b.ratio - a.ratio; });
      fuzzy = fuzzy.slice(0, 30);
    }
    return { q: q, qn: qn, exact: exact.slice(0, 100), fuzzy: fuzzy };
  }

  /* ---------------- 界面 ---------------- */
  var ui = {
    input: $("q"), results: $("results"), count: $("result-count"),
    hint: $("empty-hint"), drawer: $("drawer"), drawerMask: $("drawer-mask"),
    statLine: $("stat-line")
  };

  function refreshStats() {
    var s = stats();
    ui.statLine.textContent = "书库共 " + s.total + " 句 · 内置 " + s.builtin + " · 云端 " + s.remote + " · 我的 " + s.custom;
  }

  // 高亮：根据归一化坐标取回原文区间
  function highlight(entry, pos, len) {
    var r = norm(entry.t), map = r.map;
    if (pos < 0 || pos >= map.length) return esc(entry.t);
    var start = map[pos];
    var end = (pos + len - 1 < map.length) ? map[pos + len - 1] + 1 : entry.t.length;
    return esc(entry.t.slice(0, start)) + "<mark>" + esc(entry.t.slice(start, end)) + "</mark>" + esc(entry.t.slice(end));
  }

  function badge(res) {
    if (res.ratio >= 0.999) return '<span class="badge badge-exact">原句命中</span>';
    var pct = Math.round(res.ratio * 100);
    var cls = pct >= 85 ? "badge-high" : "badge-mid";
    return '<span class="badge ' + cls + '">相似 ' + pct + "%</span>";
  }

  function cardHTML(res) {
    var e = res.e;
    var meta = [];
    if (e.b) meta.push("<b>" + esc(e.b) + "</b>");
    if (e.c) meta.push(esc(e.c));
    if (e.a) meta.push(esc(e.a));
    var note = e.note ? '<div class="note">注：' + esc(e.note) + "</div>" : "";
    var srcTag = e.src && e.src !== "builtin" ? '<span class="src-tag">' + esc(e.src === "custom" ? "我的添加" : e.src) + "</span>" : "";
    return '<div class="card">' +
      '<div class="quote">' + highlight(e, res.pos, res.len) + "</div>" +
      '<div class="meta">' + meta.join(" · ") + srcTag + badge(res) + "</div>" +
      note +
      '<div class="card-actions">' +
      '<button class="btn-mini" data-copy="' + esc(JSON.stringify(e)) + '">复制</button>' +
      (e.src === "custom" ? '<button class="btn-mini danger" data-del="' + esc(e.t) + '">删除</button>' : "") +
      "</div></div>";
  }

  function render(res) {
    if (!res) { ui.results.innerHTML = ""; ui.count.textContent = ""; ui.hint.style.display = ""; return; }
    var html = "";
    if (res.exact.length) {
      html += '<div class="group-title">精确匹配（' + res.exact.length + "）</div>";
      html += res.exact.map(cardHTML).join("");
    }
    if (res.fuzzy.length) {
      html += '<div class="group-title">相似句子（' + res.fuzzy.length + "）</div>";
      html += res.fuzzy.map(cardHTML).join("");
    }
    if (!html) {
      html = '<div class="card empty"><div class="big">📖</div>' +
        "<p>书库里<strong>没有找到</strong>「" + esc(res.q) + "」</p>" +
        '<p class="muted">可能是：① 这句话不在当前书库 ② 字词有出入（试试只搜关键词）③ 出自某本还没导入的书</p>' +
        '<div class="btn-row"><button class="btn small" id="btn-import-text">导入这本书的文本</button>' +
        '<button class="btn small ghost" id="btn-add-manual">手动添加这句</button></div></div>';
    }
    ui.results.innerHTML = html;
    ui.count.textContent = res.exact.length || res.fuzzy.length
      ? "找到 " + (res.exact.length + res.fuzzy.length) + " 条结果" : "";
    ui.hint.style.display = "none";

    var imp = $("btn-import-text");
    if (imp) imp.onclick = function () { openImport(res.q); };
    var add = $("btn-add-manual");
    if (add) add.onclick = function () { openManual(res.q); };
  }

  function doSearch() {
    var q = ui.input.value;
    var res = search(q);
    render(res);
    try {
      if (res && q) history.replaceState(null, "", "#q=" + encodeURIComponent(q));
      else if (!q) history.replaceState(null, "", location.pathname + location.search);
    } catch (e) { /* file:// 等环境下忽略 URL 更新失败 */ }
  }

  /* ---------------- 事件绑定 ---------------- */
  $("btn-search").onclick = doSearch;
  ui.input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") doSearch(); });
  var debounce = null;
  ui.input.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { if (ui.input.value.trim().length >= 2) doSearch(); }, 350);
  });

  $("btn-random").onclick = function () {
    var e = corpus[Math.floor(Math.random() * corpus.length)];
    ui.input.value = e.t; doSearch();
  };

  $("btn-share").onclick = function () {
    var url = location.href.split("#")[0] + "#q=" + encodeURIComponent(ui.input.value || "");
    var done = function () { toast("链接已复制，发给好友吧"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    } else { fallbackCopy(url); done(); }
  };

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  // 结果卡片：复制 / 删除（事件委托）
  ui.results.addEventListener("click", function (ev) {
    var cp = ev.target.closest("[data-copy]");
    if (cp) {
      var e = JSON.parse(cp.getAttribute("data-copy"));
      var text = "「" + e.t + "」" + (e.b ? " —— 出自《" + e.b + "》" : "");
      if (e.c) text += " " + e.c;
      if (e.a) text += " " + e.a;
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("已复制"); } catch (err) { toast("复制失败"); }
      document.body.removeChild(ta);
      return;
    }
    var del = ev.target.closest("[data-del]");
    if (del) {
      var t = del.getAttribute("data-del");
      custom = custom.filter(function (q) { return q.t !== t; });
      saveJSON(LS_CUSTOM, custom);
      rebuild(); toast("已删除");
    }
  });

  /* ---------------- 抽屉（书库管理） ---------------- */
  function openDrawer() { ui.drawer.classList.add("open"); ui.drawerMask.classList.add("show"); renderDrawer(); }
  function closeDrawer() { ui.drawer.classList.remove("open"); ui.drawerMask.classList.remove("show"); }
  $("btn-lib").onclick = openDrawer;
  ui.drawerMask.onclick = closeDrawer;

  function renderDrawer() {
    var s = stats();
    $("drawer-stats").textContent =
      "内置名句 " + s.builtin + " 条 · 云端书库 " + s.remote + " 条 · 我的添加 " + s.custom + " 条";
    // 云端书库列表
    var libHtml = remoteLibs.length
      ? remoteLibs.map(function (l, i) {
        return '<div class="lib-item"><span>' + esc(l.name) + "（" + (l.quotes || []).length + '句）</span>' +
          '<button class="btn-mini danger" data-rlib="' + i + '">移除</button></div>';
      }).join("")
      : '<p class="muted">还没有云端书库。在链接后加 ?lib=书库JSON网址 即可加载。</p>';
    $("lib-list").innerHTML = libHtml;
    // 自定义列表
    var cHtml = custom.length
      ? custom.map(function (q) {
        return '<div class="lib-item"><span>「' + esc(q.t.slice(0, 24)) + (q.t.length > 24 ? "…" : "") + "」" +
          (q.b ? " 《" + esc(q.b) + "》" : "") + '</span><button class="btn-mini danger" data-cdel="' + esc(q.t) + '">删除</button></div>';
      }).join("")
      : '<p class="muted">还没有手动添加的句子。</p>';
    $("custom-list").innerHTML = cHtml;
  }

  $("drawer").addEventListener("click", function (ev) {
    var rl = ev.target.closest("[data-rlib]");
    if (rl) {
      remoteLibs.splice(Number(rl.getAttribute("data-rlib")), 1);
      saveJSON(LS_LIBS, remoteLibs); rebuild(); renderDrawer(); toast("已移除该书库");
      return;
    }
    var cd = ev.target.closest("[data-cdel]");
    if (cd) {
      var t = cd.getAttribute("data-cdel");
      custom = custom.filter(function (q) { return q.t !== t; });
      saveJSON(LS_CUSTOM, custom); rebuild(); renderDrawer(); toast("已删除");
    }
  });

  // 标签页切换
  var tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(function (btn) {
    btn.onclick = function () {
      tabs.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll(".tab-page").forEach(function (p) { p.classList.remove("active"); });
      $("tab-" + btn.getAttribute("data-tab")).classList.add("active");
    };
  });

  /* ---------------- 导入 ---------------- */
  function rebuild() { corpus = buildCorpus(); index = corpus.map(function (e) { var r = norm(e.t); return { e: e, n: r.n, map: r.map }; }); refreshStats(); doSearch(); }

  function parseBookText(text, book, author) {
    var sentences = [], chapter = "";
    var buf = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === "\n") {
        var line = buf.trim(); buf = "";
        if (/^第[0-9一二三四五六七八九十百千万零〇]+[回章卷节部篇]/.test(line)) { chapter = line.replace(/[。！？!?]$/, ""); continue; }
        if (line) buf = line;
        continue;
      }
      buf += ch;
      if ("。！？!?".indexOf(ch) >= 0) {
        var s = buf.trim();
        if (s.replace(/[\s　]/g, "").length >= 2) sentences.push({ t: s, b: book, c: chapter || "", a: author || "" });
        buf = "";
      }
    }
    var tail = buf.trim();
    if (tail.replace(/[\s　]/g, "").length >= 2) sentences.push({ t: tail, b: book, c: chapter || "", a: author || "" });
    return sentences;
  }

  function openImport() {
    $("import-text").value = "";
    $("import-book").value = "";
    $("import-author").value = "";
    openDrawer();
    document.querySelector('[data-tab="import"]').click();
  }
  function openManual(prefill) {
    $("manual-text").value = prefill || "";
    $("manual-book").value = ""; $("manual-chapter").value = ""; $("manual-author").value = "";
    $("modal-manual").classList.add("show");
  }

  $("fab-add").onclick = function () { openManual(""); };
  $("btn-parse-text").onclick = function () {
    var text = $("import-text").value.trim();
    var book = $("import-book").value.trim() || "我的导入";
    var author = $("import-author").value.trim();
    if (!text) { toast("请先粘贴文本"); return; }
    var parsed = parseBookText(text, book, author);
    if (!parsed.length) { toast("没解析出句子，请检查文本"); return; }
    custom = custom.concat(parsed);
    saveJSON(LS_CUSTOM, custom);
    rebuild();
    toast("已导入 " + parsed.length + " 句，来自《" + book + "》");
  };

  // JSON 文件 / JSON 粘贴
  function importJSON(obj, done) {
    var arr = Array.isArray(obj) ? obj : (obj.quotes || obj.items || obj.data);
    if (!Array.isArray(arr)) throw new Error("不是合法的句子数组");
    var n = 0;
    arr.forEach(function (q) {
      if (q && typeof q.t === "string" && q.t.trim()) { custom.push({ t: q.t, b: q.b || q.book || "", c: q.c || q.chapter || "", a: q.a || q.author || "", note: q.note || "" }); n++; }
    });
    if (!n) throw new Error("数组中没有有效的句子（需要 t 字段）");
    saveJSON(LS_CUSTOM, custom);
    rebuild(); toast("已导入 " + n + " 句");
    if (done) done();
  }
  $("btn-import-json").onclick = function () {
    var text = $("import-json-text").value.trim();
    if (!text) { toast("请粘贴 JSON"); return; }
    try { importJSON(JSON.parse(text)); }
    catch (e) { toast("JSON 解析失败：" + e.message); }
  };
  $("import-file").addEventListener("change", function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { importJSON(JSON.parse(reader.result)); }
      catch (e) { toast("文件解析失败：" + e.message); }
    };
    reader.readAsText(f);
  });

  $("btn-manual-save").onclick = function () {
    var t = $("manual-text").value.trim();
    if (!t) { toast("句子不能为空"); return; }
    custom.push({ t: t, b: $("manual-book").value.trim(), c: $("manual-chapter").value.trim(), a: $("manual-author").value.trim() });
    saveJSON(LS_CUSTOM, custom);
    rebuild(); $("modal-manual").classList.remove("show"); toast("已添加");
  };

  // 导出
  $("btn-export").onclick = function () {
    var blob = new Blob([JSON.stringify(custom, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "shuli-my-library.json";
    a.click(); URL.revokeObjectURL(a.href);
  };
  $("btn-clear-custom").onclick = function () {
    if (!custom.length) { toast("本来就是空的"); return; }
    if (confirm("确定清空我的添加（" + custom.length + " 句）吗？")) {
      custom = []; saveJSON(LS_CUSTOM, custom); rebuild(); renderDrawer(); toast("已清空");
    }
  };

  // 关闭弹窗
  document.querySelectorAll(".modal-close").forEach(function (b) {
    b.onclick = function () { b.closest(".modal").classList.remove("show"); };
  });
  document.querySelectorAll(".modal").forEach(function (m) {
    m.addEventListener("click", function (ev) { if (ev.target === m) m.classList.remove("show"); });
  });

  /* ---------------- 云端书库 ?lib= ---------------- */
  function loadRemoteLibs(callback) {
    var urls = [];
    location.search.slice(1).split("&").forEach(function (p) {
      var kv = p.split("=");
      if (decodeURIComponent(kv[0] || "") === "lib" && kv[1]) urls.push(decodeURIComponent(kv[1]));
    });
    if (!urls.length) { callback(); return; }
    var pending = urls.length;
    var done = false;
    urls.forEach(function (url) {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem("shuli.lib." + url) || "null"); } catch (e) {}
      if (cached && cached.quotes) {
        remoteLibs.push({ name: cached.name || url, url: url, quotes: cached.quotes });
        if (--pending === 0 && !done) { done = true; callback(); }
        return;
      }
      fetch(url).then(function (r) { return r.json(); }).then(function (data) {
        var arr = Array.isArray(data) ? data : (data.quotes || data.items || []);
        var name = (data && data.name) || url.replace(/^https?:\/\//, "").slice(0, 30);
        remoteLibs.push({ name: name, url: url, quotes: arr });
        try { localStorage.setItem("shuli.lib." + url, JSON.stringify({ name: name, quotes: arr })); } catch (e) {}
      }).catch(function () { toast("云端书库加载失败：" + url.slice(0, 40)); })
        .finally(function () {
          saveJSON(LS_LIBS, remoteLibs);
          if (--pending === 0 && !done) { done = true; callback(); }
        });
    });
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  /* ---------------- 启动 ---------------- */
  refreshStats();
  loadRemoteLibs(function () {
    rebuild();
    var h = new URLSearchParams(location.hash.slice(1)).get("q");
    if (h) { ui.input.value = h; doSearch(); }
    else ui.input.focus();
  });
})();
