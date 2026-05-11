# Changelog

历史修复与架构决策记录。日常开发不需要读此文件，仅在追溯历史决策时参考。

---

## 2026-03-21

### 阶段二架构净化与 Bug 修复
- **剪除幽灵连线**：删除 `检查来源(IF)` 节点中遗留的指向 `Loop Over Items` 的 Weekly_Top20 分支物理连线
- **修复数据丢失**：`数据提取` Code 节点 return 字典遗漏 `collect_rate` 导致写入为空
- **解决列名错配**：用户在 Google Sheets 中将表头设为 `Time_stamp`，与 API 的 `Timestamp` 字段校验失败

### Wait 节点移除
- 循环体内已无大模型/爬虫 API 调用，全盘移除 `Wait(3秒)` 节点
- `Route by Source` Weekly_Top20 分支直连 `Loop Over Items`
- 同步更新 `build_workflow.js` 的 `NODES_TO_DELETE` 和连接重写（防止 rebuild 时 Wait 复活）

### distribution_signal 判断逻辑改进
- 移除 `\bpr\b`/`\bad\b` 正则（`\b` 在日文字符边界行为不可靠）
- 改为 hashtag 数组精确匹配（`=== 'pr'`/`=== 'ad'`/`=== 'sponsored'`）+ 长关键词 `.includes()`
- 判断优先级：付費推広 > コラボ > 官方助推（最弱信号兜底）
- 官方助推新增 `views/fans 比 > 20×` 逻辑

### Code Review Critical 修复（3项）
- **`Code 清洗2` JSON.parse 加 try/catch**：AI 输出非标准 JSON 时 return `{ error, raw }` 而非崩溃
- **`去重过滤` URL 大小写 normalize**：两侧均 `.toLowerCase().trim()` 再做 Set 比对
- **`合并结果` 无 ID 视频去重**：用 `webVideoUrl/videoUrl` 作备用去重 key，不再无条件保留

### 验证
- 周报 AI 幻觉终极验证通过（Exec #170）：DeepSeek 输出完美利用真实数据（计算平均值 5.12%），零幻觉
- 循环断点续跑策略验证：Executions → Retry with saved workflow 可无缝断点续跑

---

## 2026-03-13

### 数据源策略重构
- TikTok Creative Center 所有板块（含 Trend Discovery）本质为广告生态数据，非有机热门
- 新策略：`clockworks~tiktok-scraper` 批量抓取 10 个日本标签 + 3 个搜索关键词，综合热度评分排序（播放40%+点赞30%+评论20%+分享10%）
- 新增节点：`HTTP Request Hashtags`、`合并结果`（Code）、`数据提取`（Code）
- 删除节点：`HTTP Request1`（原 trends/discover-scraper）、`提取URL列表`
- 周报路径循环内不再使用 AI Agent，改用 `数据提取` Code 节点计算指标
- Actor input schema：`hashtags`(带#) + `searchQueries` + `proxyCountryCode:"JP"` + `searchSection:"/video"`
- 标签：面白い, かわいい, 日常, 料理, ペット, ダンス, カップル, 美容, コスメ, ファッション
- 搜索关键词：面白い, かわいい, 日常

### Google Sheets schema 修复
- exec 153 发现 appendOrUpdate 报列顺序不匹配（URL→Source 写反等）
- 根本原因：schema 列顺序与实际 Sheet 不一致，且新增列不存在于 Sheet
- 修复：用户手动在 Sheet 新增 9 列头，`build_workflow.js` schema（29列）严格按 Sheet 列顺序

### 周报 AI 幻觉修复（第三版）
- 根本原因：n8n AI Agent `text` 字段内 `={{ }}` 表达式不会被求值，AI 看到字面量 `={{ $json.data }}` 后编造所有内容
- 修复：新增 `构建周报提示词` Code 节点，用 `JSON.stringify(data)` 拼接完整 prompt
- `周报 AI Agent` text 改为 `={{ $json.prompt }}`（纯字符串引用，始终求值）
- 连接：`数据量检查 → 构建周报提示词 → 周报 AI Agent`

### 其他
- `合并结果` Code 改进：`$('HTTP Request Hashtags').all()` → `$input.all()`
- n8n 执行模型说明：`读取已有URL` 连在 `合并结果`（11条）后，11×5行=55行，Set 去重后逻辑正确

---

## 2026-03-12

### 爬虫工具替换
- `HTTP Request1` 从 `clockworks~tiktok-trends-scraper`（广告素材爬虫）替换为 `clockworks~tiktok-discover-scraper`

### 去重逻辑新增
- 新增 4 个节点：`周报参数` Set、`提取URL列表` Code、`读取已有URL` Sheets、`去重过滤` Code
- `target_count` 和 `scrape_per_tag` 在 `周报参数` 节点集中管理

### Bug 修复
- `$now.format()` → `$now.toFormat()`（3处：加Top标签 batch_id、Sheets Timestamp、Form 时间戳）
- `batch_id` 格式 token：`'yyyy-ww'` → `'yyyy-WW'`（Luxon ISO 周数）
- `Code 清洗2` 正则修复：`/^```jsons*/i` → `/^```json\s*/i`

---

## 2026-03-08 及更早

### 周报 AI 幻觉修复（第二版）
- prompt 中 `={{ }}` 表达式不求值，改为 `Code 清洗2` 节点后处理覆盖元数据字段（weekly_title, data_period, analyzed_count）

### 基础架构搭建
- Loop URL bug：`$('Loop Over Items').item.json.url` → `$json.url`
- 移除 Simple Memory（循环中污染不同视频的分析）
- `Route by Source` Switch 节点分流 Manual/Weekly_Top20
- Google Sheets Source/Batch_ID 双路径兼容：try/catch 表达式
- `数据量检查(IF)` 确保 >=2 条数据才触发 AI 周报
- 手动模式 `跳过空数据` False 路径：`检查来源(IF)` 分流错误回显
- Notion 存档周报（数据库 ID：`98f043d063f843049ce9086a62ed9e47`）
- 全链路首次跑通验证（3条视频测试，Notion 成功存档 1 条周报）
