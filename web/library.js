// 浏览器版数据加载器：与小程序 utils/library.js 对应的实现。
// 直接读取 miniprogram/library/<id><n>/data.js，不改动原始数据文件。
(function (scope) {
  var BASES = ['../miniprogram/library/', 'data/'];

  // data.js 使用 module.exports=... ；这里提供一个最小的 CommonJS 外壳。
  // Worker 里优先用 importScripts(blob:)（不依赖 eval），页面内退化为 new Function。
  function moduleFrom(code) {
    if (typeof importScripts === 'function' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      var url = URL.createObjectURL(new Blob(['var module={exports:{}};' + code + ';self.__chunk__=module.exports;'], { type: 'text/javascript' }));
      try {
        self.__chunk__ = undefined;
        importScripts(url);
        return self.__chunk__;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    var m = { exports: {} };
    new Function('module', 'exports', code)(m, m.exports);
    return m.exports;
  }

  async function read(url) {
    var res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw Error('HTTP ' + res.status + ' ' + url);
    return moduleFrom(await res.text());
  }

  async function loadLibrary(id, base) {
    var list = base ? [base] : BASES;
    var lastError = null;
    for (var i = 0; i < list.length; i++) {
      try {
        var chunks = await Promise.all([0, 1, 2].map(function (n) {
          return read(list[i] + id + n + '/data.js');
        }));
        return chunks;
      } catch (e) {
        lastError = e;
      }
    }
    throw Error('文字库加载失败（' + id + '）' + (lastError ? '：' + lastError.message : ''));
  }

  scope.BASES = BASES;
  scope.loadLibrary = loadLibrary;
})(typeof self !== 'undefined' ? self : this);
