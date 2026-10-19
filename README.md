# 言有出处 · noble-to-your-life

输入一句日常话，看看古老文字里有没有相似的回声。五个文字版本、155489 条非空经节，
检索全部在设备本地完成，不需要业务服务器，也不上传搜索词。

仓库里现在有两种形态，数据完全共用：

| 目录 | 形态 | 状态 |
| --- | --- | --- |
| `web/` | **网页版（H5）**：把链接发给微信或 QQ 好友，点开就能用 | 新增，见下 |
| `miniprogram/` | 原生微信小程序源码（WXML / WXSS / JavaScript） | 保持原样 |

---

## 网页版：发给好友就能用

不需要注册小程序，不需要备案，也不需要服务器。整站是静态文件，放到任意静态空间
（GitHub Pages、对象存储、Vercel、Netlify、自己的 VPS 都行）就是一个链接。

### 本地预览

在本仓库根目录运行：

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/web/index.html
```

> 请通过网页服务器打开。直接双击 `index.html` 用 `file://` 访问时，浏览器会拦截数据读取。

### 部署

最省事的做法是用 GitHub Pages：仓库 Settings → Pages → Build and deployment 选
**Deploy from a branch**，分支选 `main`、目录选 `/ (root)`，保存后访问
`https://<用户名>.github.io/noble-to-your-life/web/index.html`。

只想上传 `web/` 一个目录时，先把数据复制进去（约 19 MB，不会提交进 Git）：

```bash
node web/tools/prepare-data.mjs   # 生成 web/data/，并把 manifest/normalize 同步为最新
```

然后上传 `web/` 整个目录即可。网页会优先读取仓库里的 `miniprogram/library/…`，
读不到时自动回退到同目录的 `data/…`，两种部署方式都支持。

### 分享

输入句子后地址栏会自动带上 `?q=`，点右上角「**分享给好友**」即可把当前这句的链接发出去
（同一个按钮也在「格式」面板里）。好友点开就是同一个查询的结果页面，不用安装任何东西：

- 手机浏览器里点「分享给好友」会调用系统分享面板，直接选中微信或 QQ 好友即可。
- 已经打开页面时，微信里点右上角「··· → 发送给朋友」，QQ 里点「··· → 转发」，
  当前这句查询会一起带过去。
- 好友收到的卡片标题来自页面标题；如果想自定义卡片，需要接入微信 JS-SDK
  （要 AppID 和签名服务），目前没有接，保持零后端。

### 网页版做了什么

- 检索内核直接复用 `miniprogram/workers/engine.js`（**未做任何修改**），
  数据直接读取 `miniprogram/library/<版本><序号>/data.js`（**未做任何修改**），
  因此网页版和小程序版的命中结果完全一致。
- `workers/search.js` 的逻辑搬到 `web/search-core.js`，跑在 Web Worker 里
  （`web/search-worker.js`）；浏览器不支持 Worker 时自动退化为页面内检索，界面不变。
- `pages/index/index.js` 的逻辑搬到 `web/app.js`，`index.wxss` 搬到 `web/app.css`，
  字段名、状态机、引用格式模板与小程序保持一致。
- 小程序的「分享到微信」换成「分享链接」：优先调用系统分享，不支持时复制链接。
- 「关于」从二级页面改成同页面浮层，内容与小程序一致（去掉了小程序专有表述）。

---

## 小程序版

原生 WXML / WXSS / JavaScript 小程序，AppID 沿用本机已注册项目。
在微信开发者工具导入本目录（项目根目录是含 `project.config.json` 的这一层）。

支持五个版本按需加载、后台 Worker 检索、同义词匹配、精确搜索、经节定位、完整上下文、
自定义引用格式、复制、设备本地收藏及微信分享。

内置数据分为 15 个分包，完整保留 155489 条非空经节。来源与校验信息见
`miniprogram/manifest.json`。平台审核与正式上线状态见 `RELEASE.md`，
上传成功不等于审核通过或正式发布。

---

## 数据与隐私

五个版本：和合本简体、和合本繁体、文理和合本、ASV、KJV。简繁体属于同一译本，
文字来自 scrollmapper/bible_databases，来源、校验值和跳过的空经节都记在
`miniprogram/manifest.json` 里。

不生成、不改写经文，只做摘录与匹配；短句可能是整节中的摘录，请结合完整上下文理解。
收藏只保存在本机（小程序为设备存储，网页版为浏览器 localStorage），清理数据即清除。

## 测试

```bash
node --test tests/native.test.cjs   # 小程序分包数据、Worker 检索、页面逻辑
node --test tests/web.test.cjs      # 网页版数据加载、检索线程、资源完整性
```
