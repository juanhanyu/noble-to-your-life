// DOM 冒烟测试：在 jsdom 中真实加载页面并模拟用户操作
const { JSDOM } = require("jsdom");
const path = require("path");

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, "index.html"), {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  // 等待脚本加载执行
  await new Promise((res) => {
    if (window.document.readyState === "complete") return res();
    window.addEventListener("load", res);
  });
  await new Promise((r) => setTimeout(r, 300));

  const d = window.document;
  const $ = (id) => d.getElementById(id);
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log("✅", name); }
    else { fail++; console.log("❌", name, extra || ""); }
  };

  check("页面加载无报错", !!$("q") && !!$("results"));
  check("统计行已渲染", ($("stat-line") || {}).textContent.includes("书库共"), ($("stat-line") || {}).textContent);

  // 1. 精确搜索
  $("q").value = "学而不思则罔";
  $("btn-search").click();
  await new Promise((r) => setTimeout(r, 50));
  let html = $("results").innerHTML;
  check("精确搜索出结果", html.includes("论语") && html.includes("学而不思则罔"), html.slice(0, 200));
  check("显示原句命中徽标", html.includes("原句命中"));

  // 2. 模糊搜索（错别字）
  $("q").value = "学而不思则网";
  $("btn-search").click();
  await new Promise((r) => setTimeout(r, 50));
  html = $("results").innerHTML;
  check("模糊搜索找到论语", html.includes("论语") && html.includes("相似"), html.slice(0, 200));

  // 3. 高亮 mark 标签
  check("命中高亮", html.includes("<mark>"));

  // 4. 未收录
  $("q").value = "这句话绝对不可能在书里出现XYZ123";
  $("btn-search").click();
  await new Promise((r) => setTimeout(r, 50));
  html = $("results").innerHTML;
  check("未收录提示", html.includes("没有找到"), html.slice(0, 200));
  check("未收录时给出导入按钮", !!$("btn-import-text") && !!$("btn-add-manual"));

  // 5. 手动添加
  $("btn-add-manual").click();
  await new Promise((r) => setTimeout(r, 50));
  $("manual-text").value = "测试句子，来自冒烟测试";
  $("manual-book").value = "测试之书";
  $("btn-manual-save").click();
  await new Promise((r) => setTimeout(r, 50));
  check("手动添加后关闭弹窗", !$("modal-manual").classList.contains("show"));
  $("q").value = "测试句子";
  $("btn-search").click();
  await new Promise((r) => setTimeout(r, 50));
  check("能搜到手动添加句", $("results").innerHTML.includes("测试之书"));

  // 6. 导入整本书文本
  $("btn-lib").click();
  d.querySelector('[data-tab="import"]').click();
  $("import-book").value = "测试书";
  $("import-text").value = "第一章\n春风又绿江南岸。\n明月何时照我还。\n第二章\n独在异乡为异客。";
  $("btn-parse-text").click();
  await new Promise((r) => setTimeout(r, 50));
  $("q").value = "春风又绿江南岸";
  $("btn-search").click();
  await new Promise((r) => setTimeout(r, 50));
  html = $("results").innerHTML;
  check("导入文本后可检索", html.includes("测试书") && html.includes("春风又绿江南岸"), html.slice(0, 300));

  // 7. 章节识别
  check("章节被识别", $("results").innerHTML.includes("第一章"));

  // 8. 分享链接生成
  const shareBtn = $("btn-share");
  let copied = "";
  window.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  shareBtn.click();
  check("分享链接含查询词", copied.includes("#q=") && copied.includes(encodeURIComponent("春风又绿江南岸")), copied);

  // 9. 随机按钮不报错
  $("btn-random").click();
  await new Promise((r) => setTimeout(r, 50));
  check("随机名句可用", $("results").innerHTML.length > 100);

  console.log("\n结果:", pass, "通过,", fail, "失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("💥 致命错误:", e); process.exit(1); });
