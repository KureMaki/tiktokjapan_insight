/**
 * TT-Insight 工作流重构脚本
 * 基于 workflow_before_hashtag_strategy.json (28节点) 构建新工作流
 *
 * 变更摘要：
 * - 新增: HTTP Request Hashtags, 合并结果, 数据提取
 * - 修改: 周报参数, 去重过滤, Append or update row in sheet, 周报 AI Agent
 * - 删除: HTTP Request1, 提取URL列表
 * - 重写连接: 周报参数→HRH→合并结果→读取已有URL; 加Top标签→数据提取→Sheets
 */

const fs = require('fs');
const path = require('path');

// Load .env (no external dependencies required)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch (e) {}

const NODES = {
  HTTP_REQ_HASHTAGS: 'HTTP Request Hashtags',
  MERGE_RESULTS: '合并结果',
  DATA_EXTRACT: '数据提取',
  BUILD_PROMPT: '构建周报提示词',
  WEEKLY_PARAMS: '周报参数',
  DEDUP: '去重过滤',
  SHEETS: 'Append or update row in sheet',
  CLEAN_CODE: 'Code 清洗2',
  WEEKLY_AI: '周报 AI Agent',
  READ_URLS: '读取已有URL',
  ADD_TOP_TAG: '加Top标签',
  EDIT_FIELDS: 'Edit Fields',
  DATA_CHECK: '数据量检查',
  ROUTE_SOURCE: 'Route by Source',
  LOOP: 'Loop Over Items',
  AGGREGATE: 'Aggregate',
  MERGE_AGGREGATE: '合并结果_Aggregate',
  HTTP_REQ_1: 'HTTP Request1',
  EXTRACT_URLS: '提取URL列表',
  WAIT: 'Wait'
};

const BASE = 'D:/myprojects/TT-insight';
const SOURCE = path.join(BASE, 'backups/workflow_before_hashtag_strategy.json');
const OUTPUT = path.join(BASE, 'backups/workflow_hashtag_strategy_new.json');

// Read base workflow
const wf = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

// ===== STEP 1: Delete unwanted nodes =====
const NODES_TO_DELETE = [NODES.HTTP_REQ_1, NODES.EXTRACT_URLS, NODES.WAIT, NODES.DATA_EXTRACT];
wf.nodes = wf.nodes.filter(n => !NODES_TO_DELETE.includes(n.name));
console.log(`After deletion: ${wf.nodes.length} nodes`);

// ===== STEP 2: Modify 周报参数 (add min_plays, max_age_days; set test values) =====
const weeklyParams = wf.nodes.find(n => n.name === NODES.WEEKLY_PARAMS);
const assigns = weeklyParams.parameters.assignments.assignments;
// Update existing: target_count=20 (prod), scrape_per_tag=15 (prod)
assigns.find(a => a.name === 'target_count').value = 20;
assigns.find(a => a.name === 'scrape_per_tag').value = 15;
// Add new params
assigns.push(
  { id: 'min-plays-001', name: 'min_plays', value: 10000, type: 'number' },
  { id: 'max-age-001', name: 'max_age_days', value: 30, type: 'number' }
);
console.log('✓ Modified 周报参数');

// ===== STEP 3: Modify 去重过滤 (use 合并结果 as source, score-based top N) =====
const dedup = wf.nodes.find(n => n.name === NODES.DEDUP);
dedup.parameters.jsCode = `// 过滤已在 Google Sheets 中存在的 URL，按热度取 Top N
const aggregateItem = $('${NODES.MERGE_AGGREGATE}').first();
const trendingItems = aggregateItem ? (aggregateItem.json.data || []) : [];
const existingRows = $('${NODES.READ_URLS}').all();
const targetCount = $('${NODES.WEEKLY_PARAMS}').first().json.target_count;

// 构建已有 URL 集合（统一 lowercase+trim，避免大小写不一致导致去重失效）
const existingUrls = new Set(
  existingRows.map(r => (r.json.URL || '').toLowerCase().trim()).filter(Boolean)
);

// 过滤出新视频（已按热度排序，保持顺序）
const newItems = trendingItems.filter(item => !existingUrls.has((item.url || '').toLowerCase().trim()));

console.log(\`去重结果: 总计\${trendingItems.length}条，已有\${existingUrls.size}条，新视频\${newItems.length}条，取Top\${targetCount}条\`);

if (newItems.length === 0) {
  return [];
}

// 已按热度分数排序，直接取 Top N
return newItems.slice(0, targetCount).map(json => ({ json }));`;
console.log('✓ Modified 去重过滤');

// ===== STEP 4: Modify Google Sheets column mapping =====
// Schema 顺序必须与 Google Sheets 实际列顺序完全一致：
// 原始 20 列 (A-T) + 新增 9 列 (U-AC)
// 原始: Source, Batch_ID, URL, Title, Hashtags, Play_Count, Digg_Count, Comment_Count,
//       Collect_Count, Share_Count, Market_Rating, Hook_Analysis, Audience_Vibe,
//       Cultural_Keyword, content_format, distribution_signal, Risk_Factor, Business_Insight,
//       Methodology, Timestamp
// 新增: Author, Author_Fans, Like_Ratio, Engagement_Rate, Content_Category,
//       Create_Time, Rank, Score, Collect_Rate
const sheetsNode = wf.nodes.find(n => n.name === NODES.SHEETS);
sheetsNode.parameters.columns.value = {
  // 原始 20 列 — 顺序与 Sheets 一致
  "Source":              "={{ (() => { try { return $('" + NODES.ADD_TOP_TAG + "').item.json.source_type } catch(e) { return $('" + NODES.EDIT_FIELDS + "').item.json.source_type } })() }}",
  "Batch_ID":            "={{ (() => { try { return $('" + NODES.ADD_TOP_TAG + "').item.json.batch_id } catch(e) { return $('" + NODES.EDIT_FIELDS + "').item.json.batch_id } })() }}",
  "URL":                 "={{ $json.url || $json.output?.url || '' }}",
  "Title":               "={{ $json.title || $json.output?.title || '' }}",
  "Hashtags":            "={{ $json.hashtags || $json.output?.top_5_hashtags || '' }}",
  "Play_Count":          "={{ $json.play_count !== undefined ? $json.play_count : ($json.output?.stats?.play || '') }}",
  "Digg_Count":          "={{ $json.digg_count !== undefined ? $json.digg_count : ($json.output?.stats?.digg || '') }}",
  "Comment_Count":       "={{ $json.comment_count !== undefined ? $json.comment_count : ($json.output?.stats?.comment || '') }}",
  "Collect_Count":       "={{ $json.collect_count !== undefined ? $json.collect_count : ($json.output?.stats?.collect || '') }}",
  "Share_Count":         "={{ $json.share_count !== undefined ? $json.share_count : ($json.output?.stats?.share || '') }}",
  "Market_Rating":       "={{ $json.output?.market_level_rating || '' }}",
  "Hook_Analysis":       "={{ $json.output?.hook_analysis || '' }}",
  "Audience_Vibe":       "={{ $json.output?.audience_vibe || '' }}",
  "Cultural_Keyword":    "={{ $json.output?.cultural_keyword || '' }}",
  "content_format":      "={{ $json.output?.content_format || '' }}",
  "distribution_signal": "={{ $json.distribution_signal || $json.output?.distribution_signal || '' }}",
  "Risk_Factor":         "={{ $json.output?.risk_factor || '' }}",
  "Business_Insight":    "={{ $json.output?.business_insight || '' }}",
  "Methodology":         "={{ $json.output?.copyable_methodology || '' }}",
  "Author":              "={{ $json.author || '' }}",
  "Author_Fans":         "={{ $json.author_fans !== undefined ? String($json.author_fans) : '' }}",
  "Like_Ratio":          "={{ $json.like_ratio || '' }}",
  "Engagement_Rate":     "={{ $json.engagement_rate || '' }}",
  "Content_Category":    "={{ $json.content_category || '' }}",
  "Create_Time":         "={{ $json.create_time || '' }}",
  "Rank":                "={{ $json._rank !== undefined ? String($json._rank) : '' }}",
  "Score":               "={{ $json._score !== undefined ? String(Math.round($json._score || 0)) : '' }}",
  "Collect_Rate":        "={{ $json.collect_rate || '' }}",
  "Time_stamp":          "={{ $now.toFormat('yyyy-MM-dd HH:mm:ss') }}"
};

sheetsNode.parameters.columns.schema = [
  // 原始 20 列（严格匹配 Sheet A-T 列顺序）
  { id: "Source",              displayName: "Source",              required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Batch_ID",            displayName: "Batch_ID",            required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "URL",                 displayName: "URL",                 required: false, defaultMatch: true,  display: true, type: "string", canBeUsedToMatch: true },
  { id: "Title",               displayName: "Title",               required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Hashtags",            displayName: "Hashtags",            required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Play_Count",          displayName: "Play_Count",          required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Digg_Count",          displayName: "Digg_Count",          required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Comment_Count",       displayName: "Comment_Count",       required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Collect_Count",       displayName: "Collect_Count",       required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Share_Count",         displayName: "Share_Count",         required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Market_Rating",       displayName: "Market_Rating",       required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Hook_Analysis",       displayName: "Hook_Analysis",       required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Audience_Vibe",       displayName: "Audience_Vibe",       required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Cultural_Keyword",    displayName: "Cultural_Keyword",    required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "content_format",      displayName: "content_format",      required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "distribution_signal", displayName: "distribution_signal", required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Risk_Factor",         displayName: "Risk_Factor",         required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Business_Insight",    displayName: "Business_Insight",    required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Methodology",         displayName: "Methodology",         required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Author",              displayName: "Author",              required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Author_Fans",         displayName: "Author_Fans",         required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Like_Ratio",          displayName: "Like_Ratio",          required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Engagement_Rate",     displayName: "Engagement_Rate",     required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Content_Category",    displayName: "Content_Category",    required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Create_Time",         displayName: "Create_Time",         required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Rank",                displayName: "Rank",                required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Score",               displayName: "Score",               required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Collect_Rate",        displayName: "Collect_Rate",        required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true },
  { id: "Time_stamp",          displayName: "Time_stamp",          required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true }
];
console.log('✓ Modified Google Sheets column mapping (29 columns, 正确列顺序)');

// ===== STEP 4.5: Fix Code 清洗2 — add try/catch around JSON.parse =====
// Risk: if AI outputs malformed JSON, the whole report chain crashes silently
const cleanNode = wf.nodes.find(n => n.name === NODES.CLEAN_CODE);
cleanNode.parameters.jsCode = `const raw = $input.first().json.output;
const cleaned = raw.replace(/^\`\`\`json\\s*/i, "").replace(/\`\`\`\\s*$/, "").trim();

let report;
try {
  report = JSON.parse(cleaned);
} catch (e) {
  console.error('JSON parse failed:', e.message, '| raw preview:', cleaned.slice(0, 300));
  return [{ json: { error: 'Invalid JSON from AI', parse_error: e.message, raw: cleaned.slice(0, 500) } }];
}

// 用 n8n 计算值覆盖 AI 的元数据，防止幻觉
const now = $now;
const weekInMonth = Math.ceil(now.day / 7);
report.weekly_title = now.toFormat("yyyy年M月") + "第" + weekInMonth + "周 TikTok 日区内容洞察周报";
report.data_period = now.startOf("week").toFormat("yyyy-MM-dd") + " ~ " + now.endOf("week").toFormat("yyyy-MM-dd");
report.analyzed_count = $('${NODES.AGGREGATE}').first().json.data.length;

return [{ json: report }];`;
console.log('✓ Fixed Code 清洗2 (added try/catch around JSON.parse)');

// ===== STEP 5: Modify 周报 AI Agent — text now reads from pre-built prompt node =====
// Root cause fix: n8n AI Agent does NOT evaluate ={{ }} expressions in `text` field.
// The literal string "={{ $json.data }}" was sent to the AI, causing it to hallucinate everything.
// Fix: a new Code node "构建周报提示词" embeds real data via JSON.stringify() before the AI runs.
const weeklyAI = wf.nodes.find(n => n.name === NODES.WEEKLY_AI);
weeklyAI.parameters.text = '={{ $json.prompt }}';
console.log('✓ Modified 周报 AI Agent text → ={{ $json.prompt }}');

// ===== STEP 5.5: Define 构建周报提示词 Code node =====
// Runs after 数据量检查(IF) True path, before 周报 AI Agent.
// Takes $json.data (PascalCase fields from Aggregate → Sheets) and builds a complete prompt string.
const buildPromptNode = {
  "id": "build-prompt-code-001",
  "name": NODES.BUILD_PROMPT,
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1600, -160],
  "parameters": {
    "jsCode": `const data = $json.data;
const dataCount = data.length;

// Compute current date (n8n Code node has access to native JS Date)
const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const day = now.getDate();
const weekNum = Math.ceil(day / 7);
const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
const weekStr = year + '年' + month + '月第' + weekNum + '周';

const dataJson = JSON.stringify(data, null, 2);

const prompt = '# Role\\n'
  + '你是一名深耕日本市场 10 年的 TikTok 资深运营专家，同时具备平台算法、流量分发与商业化的系统性视野。\\n\\n'
  + '# Context\\n'
  + '当前日期：' + dateStr + '，本周为 ' + weekStr + '\\n\\n'
  + '以下是本周 TikTok 日区 Top' + dataCount + ' 视频的结构化元数据（JSON 数组）。\\n'
  + '每条包含：URL、Title（原文文案）、Hashtags（逗号分隔）、Author、Author_Fans（粉丝数）、Play_Count、Digg_Count、Comment_Count、Share_Count、Collect_Count、Like_Ratio（点赞/播放 %）、Engagement_Rate（总互动/播放 %）、Content_Category（基于文案关键词分类）、distribution_signal（自然流量/疑似官方助推/疑似付費推広/疑似コラボ）、Create_Time。\\n\\n'
  + '⚠️ 重要约束：\\n'
  + '- 你只能看到视频的文案文字、hashtag 和互动数字，无法看到视频画面或用户评论\\n'
  + '- 所有分析必须严格基于提供数据中的 Title/Hashtags 文本和互动指标数字\\n'
  + '- 禁止编造未在数据中出现的信息，禁止推断视频的视觉内容或音乐\\n'
  + '- 如某板块数据不足以支撑结论，明确标注"（数据不足）"而非编造内容\\n\\n'
  + '输入数据：\\n'
  + dataJson + '\\n\\n'
  + '# Task\\n'
  + '基于以上 ' + dataCount + ' 条视频的结构化数据，输出一份结构化日本 TikTok 周报。\\n'
  + '严格按照下方 JSON 格式输出，禁止包含任何开场白或解释文字。\\n\\n'
  + '# Analysis Rules\\n\\n'
  + '1. [大盘健康度 macro_health]\\n'
  + '   - 统计 Play_Count 分布：<100万 / 100-500万 / >500万 各占比（如 "3/10/3"）\\n'
  + '   - 计算所有视频 Like_Ratio 均值（去掉 % 后做算术平均），判断整体互动活跃度\\n'
  + '   - 统计 distribution_signal 各类别占比\\n'
  + '   - 综合判断本周日区流量状态（扩张/平稳/收缩）和生态健康度\\n\\n'
  + '2. [内容格局 content_landscape]\\n'
  + '   - 统计 Content_Category 各类别占比（Comedy/Daily Life/Food/Beauty/Fashion/Pets/Dance/Music/Couple/Story/Tips/Other）\\n'
  + '   - 阅读 Title 和 Hashtags，提炼本周最主导的内容主题和话题风向（举具体文案例子）\\n'
  + '   - 找出最强势的 1-2 个内容类别及其核心特征\\n\\n'
  + '3. [爆款驱动逻辑 viral_logic]\\n'
  + '   - 找出 Like_Ratio 最高的前 3 条视频，分析其文案共同特征（用数据支撑，如 "Like_Ratio=8.5%"）\\n'
  + '   - 找出 Engagement_Rate 最高的前 3 条，总结共同规律\\n'
  + '   - 从文案用词和 Hashtags 归纳触发高互动的话题类型\\n\\n'
  + '4. [文化热词图谱 cultural_map]\\n'
  + '   - 聚合所有 Hashtags，识别本周高频标签（出现≥2次优先）\\n'
  + '   - 从 Title 字段提炼本周日区高频日语表达、梗、情感词汇\\n'
  + '   - 标注新兴话题趋势（如有）\\n\\n'
  + '5. [可落地创作建议 actionable_ideas]\\n'
  + '   - 基于以上分析，输出 3 条本周可直接落地的内容创作建议\\n'
  + '   - 每条格式：【方向名】核心逻辑（引用具体数据/文案证据）+ 一句话日文文案示例\\n\\n'
  + '6. [广告生态识别 ad_ecosystem]\\n'
  + '   - 汇总 distribution_signal 非"自然流量"的视频，分析其文案/hashtag 特征\\n'
  + '   - 给出对有机创作者的启示：哪些赛道已有品牌入场，哪些仍是蓝海\\n\\n'
  + '# Output（严格 JSON，禁止输出其他任何内容）\\n'
  + '{\\n'
  + '  "weekly_title": "占位（将被后处理覆盖）",\\n'
  + '  "data_period": "占位（将被后处理覆盖）",\\n'
  + '  "analyzed_count": 0,\\n'
  + '  "macro_health": "大盘健康度：播放量分布数字（具体条数）、平均点赞率、各流量信号占比、整体生态判断（3-4句，含具体数字）",\\n'
  + '  "content_landscape": "内容格局：各Content_Category占比、主导话题趋势（含Title引用）（3-4句）",\\n'
  + '  "viral_logic": "爆款驱动逻辑：点赞率最高视频文案特征（含具体Like_Ratio数字）、触发互动的话题类型（3-4句）",\\n'
  + '  "cultural_map": "文化热词图谱：高频Hashtags统计、本周热词和文化符号（3-4句）",\\n'
  + '  "hot_hashtags": ["高频tag1", "高频tag2", "高频tag3", "高频tag4", "高频tag5"],\\n'
  + '  "actionable_ideas": "3条可落地内容方向：【方向1】逻辑+证据+日文示例 【方向2】逻辑+证据+日文示例 【方向3】逻辑+证据+日文示例",\\n'
  + '  "ad_ecosystem": "广告生态：付费/合作内容特征总结、已被占领赛道 vs 蓝海机会（2-3句）",\\n'
  + '  "weekly_full_report": "以上所有板块的完整叙述版。约800字，中文写作，关键日文词汇保留原文并括注中文。适合直接阅读，逻辑清晰，有观点有数据，体现高阶运营视野。"\\n'
  + '}';

console.log('构建周报提示词: data_count=' + dataCount + ', prompt_length=' + prompt.length);
return [{ json: { prompt: prompt, data_count: dataCount } }];`
  }
};
console.log('✓ Defined 构建周报提示词 node');

// ===== STEP 6: Add new nodes =====

// 6a. HTTP Request Hashtags (batch scraper, prod: resultsPerPage=15)
const httpHashtagsNode = {
  "id": "http-request-hashtags-001",
  "name": NODES.HTTP_REQ_HASHTAGS,
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [-784, -400],
  "parameters": {
    "method": "POST",
    "url": `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`,
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "{\"hashtags\":[\"#面白い\",\"#かわいい\",\"#日常\",\"#料理\",\"#ペット\",\"#ダンス\",\"#カップル\",\"#美容\",\"#コスメ\",\"#ファッション\"],\"searchQueries\":[\"面白い\",\"かわいい\",\"日常\"],\"resultsPerPage\":15,\"proxyCountryCode\":\"JP\",\"searchSection\":\"/video\",\"commentsPerPost\":0,\"excludePinnedPosts\":false,\"maxFollowersPerProfile\":0,\"maxFollowingPerProfile\":0,\"maxRepliesPerComment\":0,\"scrapeRelatedVideos\":false,\"shouldDownloadAvatars\":false,\"shouldDownloadCovers\":false,\"shouldDownloadMusicCovers\":false,\"shouldDownloadSlideshowImages\":false,\"shouldDownloadVideos\":false}",
    "options": {
      "timeout": 300000
    }
  }
};

// 6b. 合并结果 (dedup + date filter + play filter + score sort)
const mergeResultsNode = {
  "id": "merge-results-code-001",
  "name": NODES.MERGE_RESULTS,
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [-608, -400],
  "parameters": {
    "jsCode": `// 单次 API 调用已同时包含 hashtag + search 结果
const allItems = $input.all();
const params = $('${NODES.WEEKLY_PARAMS}').first().json;

// 1. 按 video id 去重
const seen = new Set();
const unique = [];
for (const item of allItems) {
  const vid = String(item.json.id || item.json.videoId || '');
  if (vid && !seen.has(vid)) {
    seen.add(vid);
    unique.push(item);
  } else if (!vid) {
    // 无 ID 时用 URL 作备用去重 key，防止无 ID 视频全部保留导致重复
    const urlKey = item.json.webVideoUrl || item.json.videoUrl || '';
    if (urlKey && !seen.has(urlKey)) {
      seen.add(urlKey);
      unique.push(item);
    } else if (!urlKey) {
      unique.push(item); // 真正无任何标识符的，保留（极少见）
    }
  }
}

// 2. 发布日期过滤（默认30天）
const now = Date.now() / 1000;
const maxAge = (params.max_age_days || 30) * 86400;
const recent = unique.filter(item => {
  const ct = item.json.createTime;
  if (!ct) return true; // 无日期的保留
  return (now - ct) <= maxAge;
});

// 3. 播放量过滤
const minPlays = params.min_plays || 10000;
const popular = recent.filter(item => (item.json.playCount || 0) >= minPlays);

// 4. 综合热度评分并排序（播放40% + 点赞30% + 评论10% + 收藏15% + 分享5%）
const scored = popular.map(item => {
  const d = item.json;
  const score = (d.playCount || 0) * 0.4
              + (d.diggCount || 0) * 0.3
              + (d.commentCount || 0) * 0.1
              + (d.collectCount || 0) * 0.15
              + (d.shareCount || 0) * 0.05;
  return { ...item, _score: score };
});
scored.sort((a, b) => b._score - a._score);

console.log(\`合并结果: 原始\${allItems.length}条 → 去重\${unique.length} → 30天内\${recent.length} → 播放≥\${minPlays}的\${popular.length} → 排序完成\`);

// 5. 附加 url 和排名信息
return scored.map((item, i) => ({
  json: {
    ...item.json,
    url: item.json.webVideoUrl || item.json.videoUrl || '',
    _rank: i + 1,
    _score: item._score
  }
}));`
  }
};


// 6c. 合并结果_Aggregate (用于合并N条数据为1条数组，避免 Sheets 被多次读取)
const mergeAggregateNode = {
  "id": "aggregate-merge-001",
  "name": NODES.MERGE_AGGREGATE,
  "type": "n8n-nodes-base.aggregate",
  "typeVersion": 1,
  "position": [-400, -400],
  "parameters": {
    "aggregate": "aggregateAllItemData",
    "destinationFieldName": "data"
  }
};

// 6d. 数据提取 (replace per-video AI Agent in loop, calculate metrics + categorize)
const dataExtractNode = {
  "id": "data-extract-code-001",
  "name": NODES.DATA_EXTRACT,
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [0, -320],
  "parameters": {
    "jsCode": `const d = $json;

// 计算互动指标
const likeRatio = d.playCount > 0 ? (d.diggCount / d.playCount * 100).toFixed(2) : '0';
const engagementRate = d.playCount > 0
  ? ((d.diggCount + d.commentCount + d.shareCount) / d.playCount * 100).toFixed(2) : '0';
const collectRate = d.playCount > 0 ? ((d.collectCount || 0) / d.playCount * 100).toFixed(2) : '0';

// 关键词分类（基于文案+hashtag）
const text = (d.text || '').toLowerCase();
const tags = (d.hashtags || []).map(h => String(h.name || h.title || (typeof h === 'string' ? h : '')).toLowerCase()).join(' ');
const combined = text + ' ' + tags;

let category = 'Other';
const categoryMap = [
  ['Food',       ['料理', 'レシピ', 'cooking', '食べ', 'グルメ', 'ごはん', 'スイーツ', 'お菓子', '飲み']],
  ['Pets',       ['ペット', '猫', '犬', 'cat', 'dog', '動物', 'うさぎ', 'ハムスター']],
  ['Dance',      ['ダンス', 'dance', '踊', '振付', 'choreography']],
  ['Beauty',     ['美容', 'メイク', 'makeup', 'スキンケア', 'コスメ', 'cosmetic', 'beauty', 'ネイル']],
  ['Fashion',    ['ファッション', 'fashion', 'コーデ', 'ootd', '服', 'outfit', 'wear']],
  ['Couple',     ['カップル', 'couple', '彼氏', '彼女', '恋人', '夫婦', '恋']],
  ['Music',      ['music', '歌', '弾いてみた', '歌ってみた', 'カバー', '演奏', 'cover']],
  ['Comedy',     ['面白', 'おもしろ', '笑', 'ネタ', 'あるある', 'comedy', 'funny', 'バズ', 'ツッコミ']],
  ['Daily Life', ['日常', 'vlog', '日記', 'daily', 'ルーティン', 'routine', 'life']],
  ['Story',      ['ストーリー', 'story', '体験談', '実話', 'エピソード']],
  ['Tips',       ['tips', 'ライフハック', 'hack', '裏技', '便利', '知識', '方法', 'howto']],
];
for (const [cat, keywords] of categoryMap) {
  if (keywords.some(kw => combined.includes(kw))) { category = cat; break; }
}

// 流量信号判断（改进版）
// 优先级：付費推広（明确披露） > コラボ > 官方助推（弱信号兜底）
let signal = '自然流量';
const lr = parseFloat(likeRatio);
const authorFans = d.authorMeta?.fans || d.authorStats?.followerCount || 0;

// 1. 付費推広：hashtag 精确匹配（去掉 \b，日文语境下 word boundary 不可靠）
const hashtagNames = (d.hashtags || []).map(h => String(h.name || h.title || (typeof h === 'string' ? h : '')).toLowerCase());
const hasPRTag = hashtagNames.some(t => t === 'pr' || t === 'ad' || t === 'sponsored');
const hasAdKeyword = combined.includes('提供') || combined.includes('案件') ||
                     combined.includes('タイアップ') || combined.includes('スポンサー') ||
                     combined.includes('sponsored');

// 2. コラボ
const isCollab = combined.includes('コラボ') || combined.includes('collab') ||
                 combined.includes('コラボレーション');

// 3. 官方助推：低点赞率+高播放，或粉丝少但播放量异常（views/fans 比 > 20×）
const suspectBoost = (lr < 1 && d.playCount > 500000) ||
                     (authorFans > 0 && authorFans < 50000 && d.playCount > authorFans * 20 && lr < 2);

if (hasPRTag || hasAdKeyword) signal = '疑似付費推広';
else if (isCollab) signal = '疑似コラボ';
else if (suspectBoost) signal = '疑似官方助推';

// 提取精简 hashtag 列表（最多15个）
const hashtags = (d.hashtags || []).map(h => h.name || h.title || (typeof h === 'string' ? h : '')).filter(Boolean).slice(0, 15);

return {
  json: {
    url:                d.webVideoUrl || d.videoUrl || '',
    title:              d.text || '',
    hashtags:           hashtags.join(', '),
    author:             d.authorMeta?.name || d.author?.uniqueId || '',
    author_fans:        d.authorMeta?.fans || d.authorStats?.followerCount || 0,
    play_count:         d.playCount || 0,
    digg_count:         d.diggCount || 0,
    comment_count:      d.commentCount || 0,
    share_count:        d.shareCount || 0,
    collect_count:      d.collectCount || 0,
    like_ratio:         likeRatio + '%',
    engagement_rate:    engagementRate + '%',
    collect_rate:       collectRate + '%',
    content_category:   category,
    distribution_signal: signal,
    create_time:        d.createTimeISO || (d.createTime ? new Date(d.createTime * 1000).toISOString().split('T')[0] : ''),
    source_type:        $json.source_type || 'Weekly_Top20',
    batch_id:           $json.batch_id || '',
    _rank:              $json._rank || 0,
    _score:             $json._score || 0,
  }
};`
  }
};

// Add new nodes to workflow
wf.nodes.push(httpHashtagsNode, mergeResultsNode, mergeAggregateNode, dataExtractNode, buildPromptNode);
console.log(`✓ Added 4 new nodes. Total nodes: ${wf.nodes.length}`);

// ===== STEP 7: Rewrite connections =====

// Delete connections from removed nodes
delete wf.connections[NODES.HTTP_REQ_1];
delete wf.connections[NODES.EXTRACT_URLS];

// 周报参数 → HTTP Request Hashtags (was → HTTP Request1)
wf.connections[NODES.WEEKLY_PARAMS] = {
  main: [[{ node: NODES.HTTP_REQ_HASHTAGS, type: 'main', index: 0 }]]
};

// HTTP Request Hashtags → 合并结果
wf.connections[NODES.HTTP_REQ_HASHTAGS] = {
  main: [[{ node: NODES.MERGE_RESULTS, type: 'main', index: 0 }]]
};

// 合并结果 → 合并结果_Aggregate → 读取已有URL
wf.connections[NODES.MERGE_RESULTS] = {
  main: [[{ node: NODES.MERGE_AGGREGATE, type: 'main', index: 0 }]]
};
wf.connections[NODES.MERGE_AGGREGATE] = {
  main: [[{ node: NODES.READ_URLS, type: 'main', index: 0 }]]
};

// 加Top标签 → 数据提取 (was → HTTP Request)
wf.connections[NODES.ADD_TOP_TAG] = {
  main: [[{ node: NODES.DATA_EXTRACT, type: 'main', index: 0 }]]
};

// 数据提取 → Append or update row in sheet
wf.connections[NODES.DATA_EXTRACT] = {
  main: [[{ node: NODES.SHEETS, type: 'main', index: 0 }]]
};

const dataCheckKey = wf.connections[`${NODES.DATA_CHECK}(IF)`] ? `${NODES.DATA_CHECK}(IF)` :
                     wf.connections[NODES.DATA_CHECK]      ? NODES.DATA_CHECK      : null;
if (dataCheckKey) {
  wf.connections[dataCheckKey].main[0] = [{ node: NODES.BUILD_PROMPT, type: 'main', index: 0 }];
  console.log('✓ Redirected ' + dataCheckKey + ' True → ' + NODES.BUILD_PROMPT);
} else {
  console.warn('⚠️  数据量检查 connection not found — skipping redirect');
}

// 构建周报提示词 → 周报 AI Agent
wf.connections[NODES.BUILD_PROMPT] = {
  main: [[{ node: NODES.WEEKLY_AI, type: 'main', index: 0 }]]
};

// Wait 节点已删除，Route by Source Weekly_Top20 分支直连 Loop Over Items
delete wf.connections[NODES.WAIT];
if (wf.connections[NODES.ROUTE_SOURCE]?.main?.[1]) {
  wf.connections[NODES.ROUTE_SOURCE].main[1] = [{ node: NODES.LOOP, type: 'main', index: 0 }];
}

console.log('✓ Rewired connections');

// Verify key connections
const connSummary = Object.entries(wf.connections).map(([from, c]) => {
  const targets = Object.entries(c).flatMap(([type, ports]) =>
    ports.flatMap((port, i) => port.map(t => `[${type}:${i}]→${t.node}`))
  );
  return `${from}: ${targets.join(', ')}`;
});
console.log('\nConnection map:');
connSummary.forEach(s => console.log(' ', s));

// ===== STEP 8: Build final payload =====
const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1' },
  staticData: null
};

fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
console.log(`\n✓ Saved to ${OUTPUT}`);
console.log(`Final node count: ${wf.nodes.length}`);
console.log('Nodes:', wf.nodes.map(n => n.name).join(' | '));
