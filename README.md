# Bilibili 直播弹幕 +1

用于哔哩哔哩直播间的 Tampermonkey（油猴）脚本。

## 功能

- 鼠标悬停时暂停单条弹幕，移开后恢复。支持滚动、反向滚动、顶部和底部固定弹幕。
- 悬停浮窗提供「回复」「复制」「复读+1」，自动避让播放器边缘，支持全屏。
- 回复复用 B 站原生「@TA」，内容由用户输入并发送；缺少发送者或不支持回复时按钮置灰。
- 右键展开以弹幕内容命名的二级菜单，在「复制弹幕」下方选择「+1 弹幕复读」。命中多条弹幕时，每个二级菜单都有独立按钮。
- 操作浮窗或右键菜单时保持弹幕暂停；支持关闭复读成功提示。

## 安装

1. 安装 Tampermonkey，导入仓库中的 `bilibili-danmaku-plus-one.user.js`。
2. 启用脚本，登录 B 站并刷新直播间。脚本需要在页面加载时接入弹幕引擎。
3. 悬停弹幕使用浮窗，或右键展开对应弹幕的二级菜单。

## 同步更新

在 Greasy Fork 的脚本管理页面配置源码同步，使用以下 Raw URL：

```text
https://raw.githubusercontent.com/KNaiFen/bilibili-danmaku-plus-one/main/bilibili-danmaku-plus-one.user.js
```

GitHub 原生 webhook 使用 `push` 事件、`application/json`。Payload URL 和 Secret 使用 Greasy Fork 账号设置提供的值，在仓库 `Settings > Webhooks` 中配置并启用 Active。

Webhook Secret 与 GitHub Actions Secrets 是不同的设置；原生 webhook 不读取仓库环境变量。不要将 Secret 写入源码、README 或提交历史。发布新版时递增脚本头部的 `@version`，再提交并推送。

## 数据与兼容性

脚本仅在 `https://live.bilibili.com/*` 生效，发送弹幕使用当前登录会话；无需填写账号、Cookie 或令牌。仓库不包含网页样本、真实账号数据、配置密钥、测试日志或截图。

播放器内部接口变化可能影响悬停和回复。回复保留 B 站原生限制；复读使用 B 站发送接口，登录状态及平台限制仍然适用。

## 开发检查

```bash
node --check bilibili-danmaku-plus-one.user.js
bash tests/run-browser-check.sh
```

浏览器检查需要 Node.js/npm、Chrome，以及本地 `.example/*_files/danmaku-v2.js*` 中保存的弹幕引擎。测试源码使用模拟数据并拦截网络，不会向直播间发送消息。网页样本和测试输出不提交；真实登录、油猴沙箱和原生回复组件需在线验证。

## 许可

沿用原脚本的 MIT 许可及 Greasy Fork 下载、更新地址。
