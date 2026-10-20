# 言有出处

日常话，找一句带出处的真实原句。内置五个译本、155489 条非空经节，检索全部在本机完成，不上传搜索词。

## 网页版（发给 QQ / 微信好友直接用）

`web/` 是由小程序移植出的纯静态网页，无需服务器、无需构建、无需小程序注册：

- 把仓库部署到任意静态托管（当前已通过 GitHub Pages 从 `web/` 目录发布），把链接发给 QQ / 微信好友，点开即在聊天内浏览器里使用。
- 页面逻辑 `web/app.js` 移植自 `miniprogram/pages/index/index.js`，方法名与流程保持一致；`web/index.html`、`web/style.css` 由 `index.wxml`、`index.wxss`（含 `app.wxss`）换算而来，结构与类名一致。
- 检索引擎 `web/engine.js`、繁简映射 `web/normalize.js`、译本元数据 `web/manifest.js`、引用模板 `web/quote.js`，以及 15 个文字库数据文件 `web/data/*.js` 与 `miniprogram/` 原件逐字节一致，未做修改。
- `web/worker.js` 对应 `miniprogram/workers/search.js`，沿用相同的消息协议（init / ready / search / results / error）；浏览器不支持 Worker 时自动退回主线程运行同一引擎。
- 关于页 `web/about.html` 对应 `miniprogram/pages/about/`。
- 单文件版（`dist/`，由 `scripts/build-standalone.cjs` 生成）为兼容手机内置浏览器，引擎直接在主线程运行，不使用 Worker；检索引擎与数据文件仍逐字节内嵌原文件。

本地预览：在仓库根目录运行 `python3 -m http.server <port>`，浏览器打开 `http://localhost:<port>/web/`。

### 怎么发给 QQ / 微信好友

**方式 A：直接发文件（不依赖任何托管，立即可用）**

两个单文件均已随仓库提交（数据与 miniprogram/ 原件一致，引擎在页面内主线程运行，无 Worker 依赖，兼容手机内置浏览器）：

| 文件 | 大小 | 说明 |
|---|---|---|
| `dist/verse-echo-cuvs.html` | 约 3.7 MB | **推荐发给微信/QQ 好友**：只内置和合本简体，手机打开快 |
| `dist/verse-echo.html` | 约 18.4 MB | 五个译本全内置（和合本简繁、文理、ASV、KJV） |

下载（合并到 main 后把 `main` 换成当前分支名 `arena/24bd818f-noble-to-your-life`）：

`https://github.com/juanhanyu/noble-to-your-life/raw/main/dist/verse-echo-cuvs.html`

发到 QQ / 微信聊天，对方**保存到手机后用浏览器打开**即可查询——无需注册、无需联网。注意：微信聊天里直接点文件是"下载/预览"，不会运行网页，必须转到手机浏览器打开。

本地重新生成：`node scripts/build-standalone.cjs`（全量）或 `node scripts/build-standalone.cjs --edition <id>`（单译本，id 见 miniprogram/manifest.js）。

**方式 B：发链接（体验最接近小程序，需一次性开启 GitHub Pages）**

在 [Settings → Pages](https://github.com/juanhanyu/noble-to-your-life/settings/pages) 选择 *Deploy from a branch*：分支选 `main`（合并本分支后；合并前可先选当前工作分支 `arena/24bd818f-noble-to-your-life`），文件夹选 `/web`，保存后约一两分钟生效。之后把链接

`https://juanhanyu.github.io/noble-to-your-life/`

发给好友，在聊天里点开即在内置浏览器中使用，收藏会留在对方设备浏览器里。

### 测试

- `node --test tests/web-port.test.cjs`：校验复用文件与原件一致、模拟 Worker 环境加载全部五个译本、检索行为、引用模板、页面结构（无第三方依赖）。
- `node --test tests/web-standalone.test.cjs`：单文件版 DOM 冒烟测试（需要 `npm i jsdom`，未安装时自动跳过）。

## 微信小程序

原生 WXML / WXSS / JavaScript 小程序，AppID 沿用本机已注册项目。

在微信开发者工具导入本目录。原网页源码保留在 Downloads/source/verse-echo。

支持五个版本按需加载、后台 Worker 检索、同义词匹配、精确搜索、经节定位、完整上下文、自定义引用格式、复制、设备本地收藏及微信分享。无需业务服务器，不上传搜索词。

内置数据分为 15 个分包，完整保留 155489 条非空经节。来源与校验信息见 miniprogram/manifest.json。

平台审核与正式上线状态见 RELEASE.md，上传成功不等于审核通过或正式发布。
