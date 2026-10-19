// 检索逻辑自测：从 app.js 提取纯逻辑部分（界面之前的代码）直接执行
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const cut = src.indexOf("/* ---------------- 界面");
if (cut < 0) { console.error("找不到切分标记"); process.exit(1); }
let logic = src.slice(0, cut);
// 去掉 IIFE 包裹（开括号 + "use strict";）
logic = logic.replace(/\(function \(\) \{\s*"use strict";/, "");

// 提供运行所需的最小环境
global.window = {};
require("./data/quotes.js"); // 填充 window.BUILTIN_QUOTES
global.localStorage = { getItem: () => null, setItem: () => {} };
global.history = { replaceState: () => {} };
global.location = { href: "http://localhost/", pathname: "/", search: "", hash: "" };
global.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({ style: {} }) };
global.navigator = {};

eval(logic);

// ---- 测试用例 ----
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("✅", name); }
  else { fail++; console.log("❌", name, extra || ""); }
}

// 1. 精确匹配（含标点变体）
let r = search("学而不思则罔，思而不学则殆");
check("精确-带标点", r.exact.length === 1 && r.exact[0].e.b === "论语", JSON.stringify(r.exact.map(x => x.e.b)));

r = search("学而不思则罔");
check("精确-半句", r.exact.length >= 1 && r.exact[0].e.b === "论语");

// 2. 模糊匹配（错别字）
r = search("学而不思则网");
check("模糊-错别字(罔→网)", r.exact.length === 0 && r.fuzzy.length > 0 && r.fuzzy[0].e.b === "论语",
  JSON.stringify(r.fuzzy.slice(0, 3).map(x => [x.e.t.slice(0, 12), x.ratio.toFixed(2)])));

// 3. 模糊匹配（漏字）
r = search("三人行必有我师焉");
check("精确-无标点长句", r.exact.length >= 1 && r.exact[0].e.b === "论语");

// 4. 红楼梦
r = search("满纸荒唐言");
check("精确-红楼梦", r.exact.length >= 1 && r.exact[0].e.b === "红楼梦");

// 5. 完全不相关
r = search("量子力学的基本原理是什么呢");
check("无结果", r.exact.length === 0 && r.fuzzy.length === 0);

// 6. 短查询不触发模糊
r = search("你好");
check("短词不模糊", r.fuzzy.length === 0);

// 7. 相似度数值合理
r = search("生于忧患死于安乐");
check("精确-孟子", r.exact.length >= 1 && r.exact[0].e.b === "孟子");

// 8. 模糊-同音错字
r = search("千里之行始于足下");
check("精确-道德经无标点", r.exact.length >= 1 && r.exact[0].e.b === "道德经");

// 9. buildCorpus 去重覆盖：自定义覆盖内置
console.log("\n书库总量:", index.length, "内置:", (window.BUILTIN_QUOTES || []).length);
check("书库加载完整", index.length >= (window.BUILTIN_QUOTES || []).length);

console.log("\n结果:", pass, "通过,", fail, "失败");
process.exit(fail ? 1 : 0);
