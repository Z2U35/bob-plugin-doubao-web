# 豆包网页翻译 · Bob 插件

让 [Bob](https://bobtranslate.com/) 能够直接使用豆包网页端翻译服务。**无需申请 API Key**，支持豆包、豆包·火山、豆包·微软三种翻译选项。

默认支持在浏览器中复制 Cookie 即可使用，**无需安装任何额外软件**；同时也提供可选的 macOS 登录助手。

---

## 特性

- **免 API Key**：直接使用豆包网页端翻译能力。
- **多引擎支持**：内置豆包翻译、豆包·火山翻译、豆包·微软翻译三种服务。
- **轻量灵活**：推荐手动填写 Cookie，无后台驻留进程；亦可搭配 macOS 登录助手自动同步登录态。
- **体验流畅**：支持流式传输 (SSE) 解析，响应迅速。
- **丰富语言**：支持简繁中文、英语、日语、韩语、法语、德语、西班牙语、俄语等常用主流语种。

## 下载

- **[Bob 插件下载 (v0.2.1)](https://github.com/Z2U35/bob-plugin-doubao-web/releases/download/v0.2.1/DoubaoWebTranslate-0.2.1.bobplugin)**
- **[v0.2.1 发布页与更新日志](https://github.com/Z2U35/bob-plugin-doubao-web/releases/tag/v0.2.1)**
- **[可选：macOS 登录助手（Apple Silicon / Intel 通用）](https://github.com/Z2U35/bob-plugin-doubao-web/releases/download/v0.2.1/DoubaoLoginHelper-0.2.0-macos-universal.zip)**

> **环境要求**：Bob 1.21.0 或更高版本。若使用登录助手，需要 macOS 13.0+。

更新插件时，从 Release 下载并安装新版 `.bobplugin`。

---

## 安装与配置

下载并双击 `.bobplugin` 文件，Bob 会自动完成安装。在 Bob 的「偏好设置 → 服务」中添加「豆包网页翻译」，并根据需求选择以下任意一种登录方式：

### 方式一：手动填写 Cookie（推荐）

该方式最为轻量，完全无需额外安装或运行辅助程序。

1. 在常用浏览器中登录 [豆包官网](https://www.doubao.com/)。
2. 按 `F12` 或右键打开浏览器的**开发者工具**，切换到 **Network / 网络** 标签页，刷新网页。
3. 选中任意一条发往 `https://www.doubao.com/` 的请求，在 **Headers / 标头** 中找到 **Request Headers / 请求标头** 下的 `Cookie`。
4. 复制该 `Cookie` 的完整值。
5. 粘贴到 Bob 插件配置的 **「Cookie」** 输入框中。
6. 点击「验证」，测试通过后即可开始使用。

> **提示**：如果 Cookie 过期，只需重新在浏览器复制最新 Cookie 替换即可。User-Agent 通常留空即可正常工作。

### 方式二：使用 macOS 登录助手（可选）

如果你希望图形化扫码登录且免去手动提取 Cookie 的步骤，可以使用登录助手：

1. 从 v0.2.1 Release 的 Assets 下载并解压 **[Doubao Login Helper（Apple Silicon / Intel 通用版）](https://github.com/Z2U35/bob-plugin-doubao-web/releases/download/v0.2.1/DoubaoLoginHelper-0.2.0-macos-universal.zip)**，将 App 移入「应用程序」文件夹并打开。
2. 在助手窗口中按提示登录豆包账号。
3. 在 Bob 插件配置中，将「登录方式」改为 **「登录助手」**。
4. 点击 Bob 插件中的「验证」，核对 Bob 与助手弹出的 6 位配对码并确认允许。
5. 返回 Bob 再次点击「验证」即可完成配置。

---

## 选项说明

| 登录方式 | 说明 |
| --- | --- |
| **手动 Cookie（推荐）** | 使用设置中填写的 Cookie，直接请求接口，轻量无后台进程。 |
| **登录助手** | 由 macOS 登录助手管理登录态并提供给插件，无需手动复制 Cookie。 |
| **自动选择** | 优先读取手动填写的 Cookie；若未填写则尝试连接登录助手。 |

---

## 常见问题与排查

| 现象 / 错误码 | 原因与排查方法 |
| --- | --- |
| **Cookie 未填写 / 格式不正确** | 检查 Cookie 格式，应复制完整的请求标头值（包含分号隔开的键值对）。 |
| **710012000 / 710012001 / 710022013** | 登录状态已失效。手动模式请重新登录并替换 Cookie；助手模式在助手中重新登录。 |
| **助手未启动 / 无法连接** | 仅影响登录助手模式。请确认登录助手处于运行状态，或切换为手动 Cookie 模式。 |
| **配对码不匹配 / 配对失效** | 确认 Bob 与助手弹窗中的 6 位码一致；若已在助手撤销授权，重新验证配对即可。 |
| **710012007 / 676010003 / HTTP 429** | 触发豆包网页端频率限制或接口繁忙，建议稍后重试。 |
| **710022002 / 710022004** | 翻译请求被上游拒绝，请检查原文内容或稍后重试。 |
| **端口 17643 被占用** | 登录助手默认使用 17643 本地端口与插件通信，请检查是否有残留进程占用。 |

---

## 开发与构建

```sh
# 运行单元测试
node --test tests/*.test.cjs

# 构建 macOS 登录助手
python3 tools/build-helper.py --output-dir dist --build-dir build

# 打包 Bob 插件
python3 tools/build.py --output-dir dist
```



---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
