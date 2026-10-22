// 检索核心：小程序 workers/search.js 的浏览器对应实现，消息格式保持一致。
// 同时被 search-worker.js（Worker 线程）和 app.js（无 Worker 时的主线程兜底）使用。
(function (scope) {
  var dataset = null;
  var loadedId = null;
  // engine.js 在本脚本之前加载（Worker 用 importScripts，页面内用 <script>），
  // 此时 module.exports 就是检索内核；之后 module 会被数据包复用，所以先取一次。
  var ENGINE = (typeof module !== 'undefined' && module.exports && module.exports.prepare)
    ? module.exports
    : scope.engine;

  function engineRef() {
    if (ENGINE) return ENGINE;
    ENGINE = (typeof module !== 'undefined' && module.exports && module.exports.prepare) ? module.exports : scope.engine;
    return ENGINE;
  }

  async function handle(message, post) {
    try {
      var engine = engineRef();
      if (!engine) throw Error('检索内核未加载');
      if (message.type === 'load') {
        if (loadedId === message.id && dataset) {
          post({ type: 'ready', id: message.id, token: message.token, count: dataset.records.length, cached: true });
          return;
        }
        var chunks = await scope.loadLibrary(message.id, message.base);
        if (message.conversion) engine.setConversion(message.conversion);
        var verses = [];
        for (var i = 0; i < chunks.length; i++) verses = verses.concat(chunks[i].verses);
        dataset = engine.prepare({
          id: chunks[0].id,
          name: chunks[0].name,
          language: chunks[0].language,
          books: chunks[0].books,
          verses: verses
        });
        loadedId = message.id;
        post({ type: 'ready', id: message.id, token: message.token, count: dataset.records.length });
        return;
      }
      if (message.type === 'search') {
        if (!dataset) throw Error('文字库未准备好');
        post({
          type: 'results',
          request: message.request,
          results: engine.search([dataset], message.query, { mode: message.mode, limit: 24 })
        });
      }
    } catch (e) {
      post({ type: 'error', message: e && e.message ? e.message : String(e), request: message.request });
    }
  }

  scope.handleSearchMessage = handle;
})(typeof self !== 'undefined' ? self : this);
