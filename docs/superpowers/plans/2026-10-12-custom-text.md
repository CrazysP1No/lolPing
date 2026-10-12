# 自定义文字实现计划

**目标：** 在桌面快捷输入文字并同步到房间其他人的屏幕。

**架构：** 扩展现有原生快捷键和房间协议，独立输入窗口通过受限 preload 提交文字；现有叠加层负责纯文本气泡。复用设置 KeyCapture 和房间传输，不增加依赖。

**技术栈：** Electron、TypeScript、DOM、React/Fluent UI、C++、Vitest。

- [x] 协议与设置：先在 `tests/shared/roomProtocol.test.ts`、`tests/shared/settings.test.ts`、`tests/shared/protocol.test.ts` 添加文字长度/内容、快捷键默认和冲突、helper 配置测试；运行对应测试确认失败。实现 `TextMsg`、`textHotkey`、`textOpen` 与扁平配置。
- [x] 原生快捷键：先在 `tests/helper/protocol.test.ts` 添加真实 helper 模拟测试；扩展 `decision.h`、`decision.cpp`、`commands.cpp`、`output.cpp`，即时暂停输入监听，按键重复不重复打开。
- [x] 房间与叠加层：先添加加密文字收发、坐标、限流及静音测试；扩展 `RoomManager`、`OverlayManager`、`OverlayEvents` 和文字 DOM 气泡，纯文本渲染、5 秒清理、数量上限。
- [x] 输入窗口：先写 `tests/main/textInputWindow.test.ts` 和输入法按键测试；新增 `textInputWindow.ts`、`preload/text.ts`、`renderer/text/`。来源校验、失焦取消、加载失败和崩溃释放监听；在 `index.ts` 统一输入与设置捕获的暂停状态。
- [x] 设置与说明：在现有快捷键设置中新增文字快捷键行；更新中英文 UI 和 README、Vite 构建入口、`Page` 类型。
- [x] 验证和审查：`npm run test:helper`、`npm test`、`npm run typecheck`、`npm run build`、`git diff --check`；针对输入窗口与文字消息做独立审查并修复可复现问题。

验证记录：TypeScript 与 Electron 构建通过；真实 UDP 和本地 WebSocket 中继文字双向收发通过。真实 Electron 页面检查覆盖中文/Emoji 输入与长度、输入法 composing 事件、Enter/Esc、纯文本防 HTML 解析、气泡位置和 5 秒清理。独立审查发现的取消后长按重复打开已补失败回归并修正。Windows 实机、真实系统中文输入法和两台物理电脑的跨网络测试未执行。
