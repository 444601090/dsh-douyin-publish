# 视频发布-抖音（dsh-douyin-publish）

抖音创作者中心自动发布插件：**上传视频 → 填标题 → 逐一点选话题标签 → 挂车检查 → 定时发布 → DOM 校验 → 发布 → 作品管理回执**。多账号各用独立 Chrome 档案，登录态互不干扰。

2026-10-29 在「红蜻蜓童鞋旗舰店」实测跑通全流程（作品 2500 → 2501，定时 2026-11-02 08:00 成功进入「定时发布中」）。

## 规则（用户定的，插件已内置）

1. 账号的发布页「添加标签」下拉里**没有「商品」选项 = 该号挂不了车 → 不发布**（给了商品参数会报错停止，纯发布可以）。
2. 简介不写；作品 = 标题 + 话题标签。
3. 话题标签必须**从下拉点选成真话题**（插件自动做，不直接打字）。
4. 定时范围：2 小时后 ~ 14 天内（平台限制）。

## 安装

```bash
dsh plugin --profile <你的 profile> add <本目录或 tgz 包>
```

装完重启 DSH。依赖 playwright-core 会自动装进 profile。

## 配置

配置文件在 `%DSH_HOME%/douyin-publish/config.json`（也可以用 GET/POST `/douyin-publish/config` 改）：

```json
{
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "素材根目录": "D:\\DownLoad\\Vedio\\抖音创作者中心",
  "账号": [
    { "名称": "旧", "port": 9222, "profileDir": "D:\\DeepSeekCode\\工作模式\\账号\\旧\\profile" }
  ]
}
```

- 每个账号一个独立 profileDir 和调试端口（9222 / 9223 / 9224…）。
- 视频参数可给绝对路径，或给文件名（在 素材根目录/<账号名>/ 下找）。

## 新电脑上能用什么

1. 装 DSH + 装本插件（tgz 包或 GitHub 源码）
2. 装 Chrome（或把 chromePath 指到 Edge）
3. 填配置（账号列表 + 素材根目录）
4. **每个账号扫一次码**（登录态是平台发的，不能随插件打包；每次跑之前先让用户扫码）
5. 之后跟 AI 说「发抖音：XX号、某条视频」即可

## 工具（AI 会话里自动可见）

| 工具 | 作用 |
|---|---|
| `douyin_publish` | 发布一条视频（账号/视频/标题/标签/定时/商品） |
| `douyin_check` | 查账号登录态、定时作品数、最近作品 |
| `douyin_queue` | 看本插件的发布/失败记录 |

规则已写进工具描述：新会话装了这个插件就自动知道怎么干，不用复述。

## 账号状态速查（2026-10-29）

| 账号 | 状态 |
|---|---|
| 旧（红蜻蜓童鞋旗舰店，抖音号 68715142428） | **挂不了车**（添加标签只有 位置/影视演艺/小程序/游戏手柄/标记万物）；纯定时发布可用 ✅ |
| FVM | 扫码登录失败，待换登录方式 |
| LEE / 新 | 待验证挂车能力 |

排期习惯：每天 08:00 / 12:00 / 16:00 / 20:00 四档，隔 4 小时。

## 关键 UI 选择器（抖音改版时先查这里）

- 标题：`input[placeholder="填写作品标题，为作品获得更多流量"]`（30 字上限；表单就绪 = 这个 input 出现，不是 textarea）
- 描述编辑器：`[contenteditable="true"]`；话题下拉 `.mention-suggest-item-container-TVOZMl .tag-dVUDkJ`，名称 `span.tag-hash-view-name-DwMEe8`（按名称精确匹配后点击）；点选成功 = `[data-mention="#"]` 蓝底话题
- 挂车能力：点 `.select-lJTtRL` 看下拉有没有「商品」
- 定时：`label:has-text("定时发布")` → `input[format="yyyy-MM-dd HH:mm"]` 填 `YYYY-MM-DD HH:mm` → Enter
- 发布：`button.primary-cECiOJ` → 自动跳转 `content/manage?enter_from=publish`
- 回执：作品管理页搜标题 + `定时: YYYY年MM月DD日 HH:mm`，作品总数 +1

## 验证环境

- DSH ≥ 0.2.0-rc.1（在 0.2.1-rc.2 上验证）
- Node ^22.19 或 ≥24
- Windows + Chrome 156；playwright-core 1.64

## 已知限制（v0.1）

- 挂商品（挂车）流程只在**没有「商品」选项的账号上验证过拦截逻辑**；有权限账号的选品面板选择器是实验性的，跑之前先拿一条真实视频验证。
- 抖音网页改版会让选择器失效：选择器集中在 `lib/publish.js`，改一处即可发新版。
- AI 模型读不了图时，插件靠 DOM 校验，截图只作回执。
