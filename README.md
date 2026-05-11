**中文** | [English](README_EN.md)

# TT-Insight — TikTok 日区内容洞察系统

自动化爬取 TikTok 日本区热门视频，计算互动指标并分类，AI 生成结构化周报，存档至 Notion。

## 系统架构

```
n8n (Docker, localhost:5678)
  ├─ Apify clockworks~tiktok-scraper  → 批量抓取日本标签+搜索视频
  ├─ Google Sheets                     → 结构化数据存储（29列）
  ├─ DeepSeek API                      → AI 周报生成（零幻觉）
  └─ Notion                            → 周报存档与展示
```

## 功能

### 阶段一：手动单视频分析
提交一条 TikTok 视频 URL → AI 深度分析（文案拆解、受众画像、商业洞察） → 结果写入 Google Sheets 并回显。

### 阶段二：每周 Top 视频自动分析 + AI 周报
一键触发 → 批量抓取 10 个日本热门标签 + 3 个搜索关键词的视频 → 去重/过滤/热度排序 → 取 Top N → 逐条计算指标并存入 Sheets → AI 生成结构化周报（大盘健康度、内容格局、爆款逻辑、文化热词、创作建议、广告生态） → 写入 Notion。

### 阶段三（规划中）：自然语言驱动的 Agent 分析
用户提出开放式问题（例如"TikTok 日区游戏视频最火方向是什么？"、"最近有哪些适合品牌投放的内容趋势？"）→ Agent 自主拆解意图、决定搜索策略 → 动态选取标签/关键词爬取 → AI 直接对视频内容进行语义理解与分类（替代当前基于关键词的规则判断）→ 综合分析后输出针对该问题的定制报告。

**阶段三不依赖 n8n**，计划采用 Claude API + 工具调用 + GitHub Actions 构建，使 Agent 能真正根据上下文做动态决策，而非执行固定管道。

---

## 运行效果

### Google Sheets 数据存储

视频原始数据（播放量、互动数、标签）与计算指标（Like_Ratio、Engagement_Rate、Content_Category、distribution_signal 等）写入同一张表，共 29 列。

![Sheets 原始数据列](docs/screenshots/sheets_data.png)
*A~T 列：来源、URL、标题、标签、各项互动数、分布信号*

![Sheets 计算指标列](docs/screenshots/sheets_data_2.png)
*U~AC 列：作者信息、Like_Ratio、Engagement_Rate、内容分类、排名、评分*

### AI 周报（Notion 存档）

每周分析完成后，DeepSeek 生成结构化周报自动写入 Notion，包含大盘健康度、内容格局、文化热词、爆款逻辑、可落地创作建议等板块。

![Notion 周报（上）](docs/screenshots/notion_report.png)
*周报头部：元数据、热门话题标签、大盘健康度、内容格局、文化热词*

![Notion 周报（下）](docs/screenshots/notion_report_2.png)
*周报下半：文化热词（续）、爆款逻辑分析、可落地创作建议*

### AI 周报输出样本

周报支持中日双语输出，核心分析字段以中文呈现，热门标签和文化关键词保留日文原文。

- [中文版周报样本](docs/samples/weekly_report_zh.txt)
- [日本語版レポートサンプル](docs/samples/weekly_report_ja.txt)

---

## 快速开始

```bash
# 1. 启动 n8n
docker-compose up -d

# 2. 打开 n8n
# http://localhost:5678

# 3. 阶段一：左侧菜单 → Forms → 填写视频 URL 提交
# 4. 阶段二：打开工作流 → 点击 Execute workflow
```

## 项目结构

```
TT-insight/
├── build_workflow.js        # 工作流构建脚本（核心，定义所有节点和连接）
├── deploy.js                # 读取构建产物 → PUT 部署到 n8n API
├── docker-compose.yml       # n8n Docker 配置
├── .env.example             # 环境变量模板
├── backups/                 # 工作流版本备份
│   ├── workflow_before_hashtag_strategy.json   # 构建基准（28节点）
│   └── workflow_hashtag_strategy_new.json      # 最新构建产物（29节点）
├── CLAUDE.md                # AI 助手工作手册（n8n API、节点说明、踩坑备忘）
└── CHANGELOG.md             # 历史修复与架构决策记录
```

---

## 技术决策与局限

### 决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 数据源 | 标签+搜索近似热门 | TikTok 无公开的日区有机热门 API，Creative Center 全是广告数据 |
| 单视频分析（周报路径） | Code 节点计算确定性指标 | AI 看不到视频画面，hook/audience 等字段纯幻觉；Code 方案成本降 90%，速度提升 10x |
| 周报 prompt 构建 | Code 节点预构建完整字符串 | n8n AI Agent 的 `text` 字段不对 `={{ }}` 表达式求值，必须在 Code 里用 `JSON.stringify` 嵌入真实数据，否则 AI 只收到字面量字符串 |
| 周报元数据 | Code 清洗节点后处理覆盖 | AI 生成的日期/数量字段不可信，用 n8n 运行时变量强制覆盖确保准确性 |
| 内容分类 | 关键词规则匹配（12类） | 批量场景下 AI 逐条分类成本高；规则对已知类目准确，新兴类目会漏判 |

### 已知局限

- **固定管道，无动态决策**：标签列表硬编码，无法根据上下文自适应调整搜索策略
- **内容理解局限于文本**：爬虫只返回标题和标签，AI 与规则判断均无法接触视频画面、音频或字幕
- **n8n 表达式限制**：AI Agent `text` 字段不求值表达式，导致需要额外 Code 节点作为中间层
- **执行模型的 fan-out**：n8n 按 incoming item 数触发节点，N 条视频会触发 N 次 Sheets 读取，产生不必要的 API 调用
- **逻辑散落在字符串里**：Code 节点的 JavaScript 以字符串形式存在 JSON 中，没有 IDE 支持、无法单元测试、diff 不直观

### 架构演进方向（阶段三）

当前 n8n 方案适合快速验证，但在 Agent 范式下同一需求的实现会有本质差异：

```
用户问题："日区游戏视频最火方向是什么？"
     ↓
Claude Agent（意图理解）
     ↓ 工具调用
  ├─ search_tiktok(hashtags=[...])   # 动态决定搜索策略
  ├─ analyze_video(title, tags)      # AI 语义理解，不依赖规则
  ├─ sheets_write(results)           # 直接 API 操作
  └─ generate_answer(question, data) # 针对原始问题定制回答
     ↓
直接回答用户问题
```

**技术栈变化**：Claude API + Tool Use → 替代 n8n AI Agent 节点；GitHub Actions → 替代 n8n 定时触发；TypeScript/Python 函数 → 替代 Code 节点字符串；去掉 n8n 框架依赖，逻辑完全在代码中，可测试、可版本控制。

---

## 依赖

- [Docker](https://www.docker.com/)
- [n8n](https://n8n.io/)（通过 Docker 运行）
- [Apify](https://apify.com/) 账号 + API Token
- [DeepSeek](https://platform.deepseek.com/) API Key
- Google Sheets API 凭据（n8n 内配置）
- Notion Integration Token（n8n 内配置）
