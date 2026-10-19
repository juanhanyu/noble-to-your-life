// 网页版关于页逻辑 —— 移植自 miniprogram/pages/about/index.js
document.getElementById('backBtn').onclick = () => history.back();
document.getElementById('copySource').onclick = async function () {
  const url = 'https://github.com/scrollmapper/bible_databases';
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    ta.remove();
  }
};
