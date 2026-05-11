# TT-Insight Project

## 项目概述
TikTok 日区内容分析系统，使用 n8n + Docker + Apify + DeepSeek API。
**当前状态**：阶段一、阶段二均已跑通，项目作为作品集收尾。
**GitHub**：https://github.com/KureMaki/tiktokjapan_insight

## 技术栈
- **n8n**：本地运行在 `http://localhost:5678`（Docker）
- **Apify**：TikTok 数据爬取（clockworks~tiktok-scraper，批量标签+搜索模式）
- **DeepSeek API**：AI 分析（模型：deepseek-reasoner）
- **Google Sheets**：数据存储（TTJ_Content_Analysis 表）

## 环境配置
密钥统一存放于 `.env`（不入库），参考 `.env.example`：
```
N8N_API_KEY=...        # n8n 设置 → API Keys 生成
N8N_WORKFLOW_ID=...    # n8n 工作流 ID（Settings → 复制）
APIFY_TOKEN=...        # console.apify.com → Integrations
```
`build_workflow.js` 和 `deploy.js` 启动时自动读取 `.env`，无需额外依赖。

## n8n API 操作规范
- **修改工作流时，直接用 n8n API，不要让用户手动下载/上传 JSON**
- API Key：见 `.env` 中的 `N8N_API_KEY`
- PUT 更新工作流只传：`{ "name", "nodes", "connections", "settings": { "executionOrder" }, "staticData": null }`
- 用 Node.js 发送请求（环境有 Node.js，无 Python）

## 当前工作流
- **ID**：见 `.env` 中的 `N8N_WORKFLOW_ID` | **名称**：My workflow | **节点数**：29
- 构建脚本：`build_workflow.js`（基于 `backups/workflow_before_hashtag_strategy.json` 构建）
- 部署脚本：`deploy.js`（读取 `backups/workflow_hashtag_strategy_new.json` → PUT 到 n8n）
- ⚠️ `backups/` 内的 JSON 文件中 Apify token 已替换为占位符 `YOUR_APIFY_TOKEN`（GitHub 安全要求）；本地运行依赖 `.env` 中的真实 token，由脚本在运行时注入

## 工作流结构

**阶段一（手动单视频分析）：**
`On form submission` → `Edit Fields`（source=Manual）→ `HTTP Request`（TikTok Scraper）→ `跳过空数据(IF)` → `AI Agent` → `Google Sheets` → `Route by Source` → `Form`（回显结果）

**阶段二（每周 Top 自动分析）：**
`Manual Trigger` → `周报参数`（Set）→ `HTTP Request Hashtags`（批量标签+搜索）→ `合并结果`（Code，去重+过滤+排序）→ `读取已有URL`（Sheets read）→ `去重过滤`（Code，取Top N）→ `Loop Over Items` → `加Top标签` → `数据提取`（Code，计算指标+分类）→ `Google Sheets` → `Route by Source` → 回到 Loop

**循环结束后：**
`Aggregate` → `数据量检查(IF)` → True path（>=2条）：`构建周报提示词`（Code）→ `周报 AI Agent`（DeepSeek）→ `Code 清洗2` → `Notion 存档周报`

## 关键节点说明

### 构建周报提示词
用 `JSON.stringify(data)` 将真实视频数据嵌入 prompt 字符串，输出 `{ prompt, data_count }`。AI Agent 的 text 参数只需引用 `={{ $json.prompt }}`。**存在原因**：n8n AI Agent `text` 字段内的 `={{ }}` 表达式不会被求值，必须用 Code 节点预构建完整 prompt。

### 周报 AI Agent
模型 DeepSeek（`DeepSeek 周报` 节点）。输入 `={{ $json.prompt }}`。输出结构化周报 JSON（macro_health, content_landscape, viral_logic, cultural_map, hot_hashtags, actionable_ideas, ad_ecosystem, weekly_full_report 等字段）。约束：只基于提供数据分析，禁止编造。

### 数据提取（替代单视频 AI Agent）
周报路径用 Code 计算确定性指标：like_ratio, engagement_rate, collect_rate, content_category（关键词匹配12类）, distribution_signal（hashtag精确匹配+views/fans比值判断）。手动路径仍保留 AI Agent。

### Code 清洗2
1. 剥离 AI 输出外层的 Markdown 代码块包裹（` ```json ``` `），安全解析 JSON（含 try/catch）
2. 用 n8n 内置变量强制覆盖 `weekly_title`、`data_period`、`analyzed_count`，确保元数据准确

## n8n 踩坑备忘

1. **AI Agent text 不求值表达式**：`text` 字段里的 `={{ }}` 原样发给 AI → 必须用 Code 节点预构建 prompt 字符串
2. **节点按 incoming item 数触发**：N 条输入 → 节点执行 N 次 → 注意 fan-out 导致的重复读取（如 Sheets 读 N 次）
3. **Luxon 时间格式**：用 `$now.toFormat()` 不是 `format()`；ISO 周数用 `yyyy-WW`（大写 W）
4. **Manual Trigger 节点名**：含 Unicode 弯引号 U+2018，用 `type === 'n8n-nodes-base.manualTrigger'` 查找
5. **Sheets schema 列顺序**：appendOrUpdate 的 schema 数组必须与实际 Sheet 列顺序完全一致，否则报列错位
6. **循环内报错恢复**：Executions 列表 → 找到 Error → **Retry with saved workflow**（断点续跑，自动应用最新代码）

## Google Sheets 列结构（TTJ_Content_Analysis 工作表1）
共 29 列，A~AC：
- **A~S（19列）**：Source, Batch_ID, URL, Title, Hashtags, Play_Count, Digg_Count, Comment_Count, Collect_Count, Share_Count, Market_Rating, Hook_Analysis, Audience_Vibe, Cultural_Keyword, content_format, distribution_signal, Risk_Factor, Business_Insight, Methodology
- **T~AB（9列）**：Author, Author_Fans, Like_Ratio, Engagement_Rate, Content_Category, Create_Time, Rank, Score, Collect_Rate
- **AC（1列）**：Time_stamp
- **matchingColumns**：`["URL"]`（以 URL 为唯一键 appendOrUpdate）

## 后续方向

阶段三不在本项目迭代范围内，计划作为独立项目重建：
- 技术栈：Claude API + Tool Use + GitHub Actions（不依赖 n8n）
- 核心能力：用户提问 → Agent 自主决定抓取策略 → AI 语义理解 → 定制回答
- 详见 README.md「架构演进方向」一节

## Docker
```bash
docker-compose up -d   # 启动 n8n（http://localhost:5678）
docker-compose down    # 停止
```
