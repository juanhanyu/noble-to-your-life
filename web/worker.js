// 网页版检索 Worker —— 对应 miniprogram/workers/search.js（小程序在 wx.createWorker 中运行同一套消息协议）。
// engine.js 与 15 个文字库 data.js 均从本目录原样加载，未做任何改动：
// 它们使用 CommonJS 的 module.exports 导出，这里用一个 module 垫片承接。
var module = { exports: {} };
importScripts('engine.js');
const engine = module.exports;

let dataset = null;

// 对应 miniprogram/utils/library.js：每个译本 3 个分包，合并为一份数据集
function loadLibrary(id) {
  const parts = [0, 1, 2].map(n => {
    module.exports = {};
    importScripts('data/' + id + n + '.js');
    return module.exports;
  });
  return { ...parts[0], verses: parts.reduce((a, c) => a.concat(c.verses), []) };
}

self.onmessage = m => { try {
  if (m.type === 'init') {
    dataset = null;
    const data = loadLibrary(m.id);
    engine.setConversion(m.conversion);
    dataset = engine.prepare(data);
    self.postMessage({ type: 'ready', count: dataset.records.length });
  }
  if (m.type === 'search') {
    if (!dataset) throw Error('文字库未准备好');
    self.postMessage({ type: 'results', request: m.request, results: engine.search([dataset], m.query, { mode: m.mode, limit: 24 }) });
  }
} catch (e) { self.postMessage({ type: 'error', message: e.message, request: m.request }); } };
