// 后台检索线程：与小程序 workers/search.js 对应。
// 直接复用 miniprogram 的 engine.js（原文件未修改），仅提供 CommonJS 外壳。
var module = { exports: {} };
var exports = module.exports;
try {
  importScripts('library.js', 'engine.js', 'search-core.js');
} catch (e) {
  self.postMessage({ type: 'error', message: '检索脚本加载失败：' + (e && e.message ? e.message : e) });
}
self.onmessage = function (event) {
  handleSearchMessage(event.data, function (message) {
    self.postMessage(message);
  });
};
