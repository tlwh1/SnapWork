const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'dist', 'index.html');
const imageDir = path.join(root, 'dist', 'images');
let html = fs.readFileSync(htmlPath, 'utf8');

for (const filename of fs.readdirSync(imageDir)) {
  if (!filename.endsWith('.webp')) continue;
  const base = filename.slice(0, -5);
  const webpPath = path.join(imageDir, filename);
  const dataUrl = `data:image/webp;base64,${fs.readFileSync(webpPath).toString('base64')}`;
  html = html.replaceAll(`images/${base}.png`, `images/${filename}`);
  html = html.replaceAll(`images/${filename}`, dataUrl);
}

const worker = `const page = ${JSON.stringify(html)};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const parseObject = (value, fallback) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
};

const cleanProgress = (value) => {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [id, raw] of Object.entries(value).slice(0, 120)) {
    if (!/^q\\d{3}$/.test(id) || !raw || typeof raw !== 'object') continue;
    const number = (key) => Math.max(0, Math.min(100000, Number(raw[key]) || 0));
    result[id] = {
      attempts: number('attempts'),
      correct: number('correct'),
      wrong: number('wrong'),
      streak: number('streak'),
      lastSeen: number('lastSeen'),
      intervalDays: number('intervalDays'),
      due: number('due'),
    };
  }
  return result;
};

const cleanSession = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const questions = Array.isArray(value.questions) ? value.questions.filter((id) => /^q\\d{3}$/.test(id)).slice(0, 10) : [];
  if (!questions.length) return null;
  const results = Array.isArray(value.results) ? value.results.slice(0, 10).map((result) => ({
    questionId: typeof result?.questionId === 'string' && /^q\\d{3}$/.test(result.questionId) ? result.questionId : '',
    correct: Boolean(result?.correct),
    userAnswer: typeof result?.userAnswer === 'string' ? result.userAnswer.slice(0, 500) : '',
  })).filter((result) => result.questionId) : [];
  return {
    questions,
    index: Math.max(0, Math.min(9, Number(value.index) || 0)),
    correct: Math.max(0, Math.min(10, Number(value.correct) || 0)),
    answered: Boolean(value.answered),
    selectedAnswer: Number.isInteger(value.selectedAnswer) ? Math.max(0, Math.min(7, value.selectedAnswer)) : null,
    results,
  };
};

const userIdFor = (request) => {
  const value = request.headers.get('oai-authenticated-user-id');
  return value && value.trim() ? value.trim().slice(0, 160) : null;
};

const handleQuizState = async (request, env) => {
  const userId = userIdFor(request);
  if (!userId) return json({ authenticated: false, error: 'sign_in_required' }, 401);
  if (!env.DB) return json({ error: 'database_unavailable' }, 503);
  try {
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT progress_json, session_json, updated_at FROM quiz_state WHERE user_id = ?1').bind(userId).first();
      return json({ authenticated: true, progress: parseObject(row?.progress_json, {}), session: row?.session_json ? parseObject(row.session_json, null) : null, updatedAt: Number(row?.updated_at) || 0 });
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const length = Number(request.headers.get('content-length')) || 0;
    if (length > 500000) return json({ error: 'payload_too_large' }, 413);
    const body = parseObject(await request.text(), {});
    const progressJson = JSON.stringify(cleanProgress(body.progress));
    const sessionValue = cleanSession(body.session);
    const sessionJson = sessionValue ? JSON.stringify(sessionValue) : null;
    const updatedAt = Date.now();
    await env.DB.prepare('INSERT INTO quiz_state (user_id, progress_json, session_json, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id) DO UPDATE SET progress_json = excluded.progress_json, session_json = excluded.session_json, updated_at = excluded.updated_at').bind(userId, progressJson, sessionJson, updatedAt).run();
    return json({ ok: true, updatedAt });
  } catch (error) {
    console.error('quiz_state', error);
    return json({ error: 'database_error' }, 500);
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/quiz/state') return handleQuizState(request, env);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    return new Response('Not found', { status: 404 });
  },
};
`;

const outputDir = path.join(root, 'dist', 'server');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.js'), worker);
console.log(`Wrote ${path.join(outputDir, 'index.js')} (${Buffer.byteLength(worker)} bytes)`);
