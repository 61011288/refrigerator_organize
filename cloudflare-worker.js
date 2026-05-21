// Cloudflare Worker：冰箱 app 的 DeepSeek 代理
// 作用：前端把 { name, location } 发给这个 Worker，Worker 用藏在
// 环境变量 DEEPSEEK_KEY 里的 key 去调 DeepSeek，返回 { days }。
// key 只存在 Cloudflare，不会出现在公开的前端代码里。
//
// 部署后需要设置：
//   1) 环境变量（Secret）DEEPSEEK_KEY = 你的 DeepSeek API key
//   2) 下面 ALLOWED 改成你的 GitHub Pages 网址

const ALLOWED = 'https://61011288.github.io';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, cors);
    }

    // 基础来源校验（挡掉随手盗用，非严格防护）
    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED) {
      return json({ error: 'forbidden origin' }, 403, cors);
    }

    let body;
    try { body = await request.json(); } catch { body = {}; }
    const name = String(body.name || '').slice(0, 50).trim();
    const loc = body.location === 'freezer' ? '冷冻' : '冷藏';
    if (!name) return json({ error: 'no name' }, 400, cors);

    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.DEEPSEEK_KEY,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          temperature: 0,
          max_tokens: 10,
          messages: [
            { role: 'system', content: '你是食品保鲜助手。根据食材名称和存放方式，估算建议食用天数。只回复一个正整数，不要任何其他文字、单位或标点。' },
            { role: 'user', content: '食材：' + name + '；存放方式：' + loc },
          ],
        }),
      });
      const data = await r.json();
      const txt = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
      const m = txt.match(/\d+/);
      const days = m ? parseInt(m[0], 10) : 0;
      return json({ days }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 502, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
