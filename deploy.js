const fs = require('fs');
const http = require('http');

// Load .env (no external dependencies required)
try {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch (e) {}

const WF_ID = process.env.N8N_WORKFLOW_ID;
const API_KEY = process.env.N8N_API_KEY;
const payload = fs.readFileSync('D:/myprojects/TT-insight/backups/workflow_hashtag_strategy_new.json', 'utf8');

const options = {
  hostname: 'localhost',
  port: 5678,
  path: `/api/v1/workflows/${WF_ID}`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': API_KEY,
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      const wf = JSON.parse(data);
      console.log(`✅ 部署成功！节点数: ${wf.nodes?.length}, 名称: ${wf.name}`);
    } else {
      console.error(`❌ 失败 ${res.statusCode}:`, data.slice(0, 500));
    }
  });
});

req.on('error', e => console.error('❌ 连接失败:', e.message));
req.write(payload);
req.end();
