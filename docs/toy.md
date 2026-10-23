# Bilibili Toy 单机发行

在仓库根目录执行（Node.js 20+、Python 3，先 `npm ci`）：

```sh
npm run typecheck
npm run test:i18n
npm run test:online
npm run test:toy
npm run package:toy
```

发行 ZIP：`artifacts/toy/iron-cage-toy.zip`；同目录 JSON 记录大小与 SHA-256。
所有产物均已忽略，不提交。相同输入的 ZIP 使用固定文件顺序、时间及压缩参数。
打包器检查官方扩展名白名单、50 MB 保守限制、根目录 `index.html` 与相对资源完整性。
代码 MIT、Three.js MIT 和素材归属分别保存在 `.md`，不会被平台过滤 `.txt` 的规则删除。

`npm run build` 保留网站版本；Toy 使用独立 Vite mode、相对 base 和独立输出目录。
Toy 保留单人练习、卡牌、音效、本机最高分/设置与中英文；联机入口说明此版不提供联机，
UI 事件与连接层同时阻止发起 WebSocket。无需任何游戏后端、账号或云数据授权。
删除 Toy HTML 中的远程 Google Fonts 请求，使用 CSS 已有的系统字体回退。
界面未使用 URL 路由，不存在路径跳转；可在任意嵌套目录与 hash 后运行。

本版本不加载远程 Toy SDK，也不依赖 `window.toy`。现有 `visualViewport`/窗口 resize、
触控瞄准/蓄力与音频手势解锁继续生效；横屏按钮使用浏览器 Fullscreen/Orientation API，
被容器拒绝时仍可竖屏游玩。不声称 Toy App 已进入沉浸横屏。
Toy 下切出页面时暂停单人练习及音频，回到页面后由玩家继续/操作解锁声音。

本地可用 `python -m http.server 5187 --directory artifacts/toy/dist` 预览。
打包 ZIP 额外包含许可证；验证上传内容时应解压 ZIP 后再从该目录提供静态服务。
桌面浏览器的手机尺寸检查仅证明布局/输入回退，不等于 B站 App 或真机验收。
投稿之前仍应在真实 Toy 容器检查横竖屏、安全区、音频恢复、触控与性能。
本构建命令不上传、不发布、不修改支付或税务配置。

可选真实浏览器回归：安装 Playwright（或通过 `PLAYWRIGHT_MODULE` 指定已有模块），
设置 `QA_URL` 为解压包的 HTTP 地址，运行 `node scripts/toy-browser-selftest.mjs`。
`CHROMIUM_PATH` 可指定已有 Chromium/Edge 可执行文件；截图与 JSON 写入 `artifacts/toy/qa`。

规则依据（2026-10-24）：
- https://www.bilibili.com/toy/publish/
- https://www.bilibili.com/toy/publish/guide/faq
- https://www.bilibili.com/toy/publish/sdk
