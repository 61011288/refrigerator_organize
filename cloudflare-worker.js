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

    // list available models (for the app's "拉取模型" button)
    if (body.action === 'models') {
      try {
        const r = await fetch('https://api.deepseek.com/models', {
          headers: { 'Authorization': 'Bearer ' + env.DEEPSEEK_KEY, 'Accept': 'application/json' },
        });
        const d = await r.json();
        const models = (d.data || []).map((m) => m.id);
        return json({ models }, 200, cors);
      } catch (e) {
        return json({ error: String(e) }, 502, cors);
      }
    }

    const name = String(body.name || '').slice(0, 50).trim();
    const loc = body.location === 'freezer' ? '冷冻' : '冷藏';
    if (!name) return json({ error: 'no name' }, 400, cors);

    const model = body.model || 'deepseek-v4-flash';
    const think = !!body.think;

    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.DEEPSEEK_KEY,
        },
        body: JSON.stringify({
          model,
          thinking: { type: think ? 'enabled' : 'disabled' },
          temperature: 0,
          max_tokens: think ? 800 : 60,
          // NOTE: ask the model to reply with ASCII only (a category NUMBER and a
          // day count). DeepSeek's Chinese response bytes get corrupted in transit
          // to this Worker, but digits survive — so we map the number to Chinese here.
          messages: [
            { role: 'system', content: 'You estimate food storage. Given a food name and storage method (冷藏=fridge, 冷冻=freezer), output ONLY JSON: {"c":N,"days":M}. N is the category number: 1=蔬菜(vegetable) 2=水果(fruit) 3=肉类(meat) 4=鱼虾(seafood) 5=蛋奶(egg/dairy) 6=酱料(sauce/condiment) 7=饮品(drink) 8=其他(other). M is the integer number of days it stays safe to eat under that method (use food-safety norms; frozen items usually last months). No other text.' },
            { role: 'user', content: 'Food: ' + name + '; Storage: ' + loc },
          ],
        }),
      });
      const data = await r.json();
      const txt = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();

      const CATS = { 1: '蔬菜', 2: '水果', 3: '肉类', 4: '鱼虾', 5: '蛋奶', 6: '酱料', 7: '饮品', 8: '其他' };
      let category = '其他', days = 0;
      try {
        const j = JSON.parse(txt.replace(/```json|```/g, '').trim());
        if (j.c != null && CATS[j.c]) category = CATS[j.c];
        if (j.days != null) days = parseInt(j.days, 10) || 0;
      } catch {
        const nums = txt.match(/\d+/g) || [];
        if (nums[0] && CATS[nums[0]]) category = CATS[nums[0]];
        if (nums[1]) days = parseInt(nums[1], 10) || 0;
      }
      if (body.debug) return json({ days, category, raw: txt }, 200, cors);
      return json({ days, category }, 200, cors);
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
