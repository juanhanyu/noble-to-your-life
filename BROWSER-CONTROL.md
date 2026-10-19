# 浏览器控制诊断

已运行插件提供的四项官方诊断，结果均正常：Chrome 正在运行、Chrome 已安装、Profile 1 中 ChatGPT 扩展已安装并启用、Native Messaging 注册与 manifest 匹配。

已重建 JavaScript 会话、重新打开扩展对应的 Chrome 配置窗口，并新建公众平台控制标签页。新标签页能正常导航、读取页面 DOM 和截图；原标签页出现 Debugger unattached。

两次点击「填写」均在命令下发前超时。未修改或提交基础信息。桌面日志另外记录内置浏览器聊天路由不存在，因此不将其当作可靠替代。

当前只恢复了读取，不能声称完整控制已修复。没有修改安全设置、扩展权限、连接程序或注册表。下一步需完整退出并重新打开 Chrome 和 Codex，重建应用连接，再验证点击。重启 Codex 会结束当前执行会话，需要用户亲自完成。

官方指引：https://learn.chatgpt.com/docs/chrome-extension

小程序 1.0.0 开发版本已通过开发者工具独立上传成功。正式发布尚未完成。
