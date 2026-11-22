// 로컬 테스트용 무의존성 Node.js (v18+) 개발 서버
// 실행: node dev-server.mjs  ->  http://localhost:8788
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as routeSearchPost } from './functions/api/route-search.js';
import { onRequestPost as detourPost } from './functions/api/detour.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '8788', 10);

// .env 파일 자동 로드
function loadEnv() {
  const env = { ...process.env };
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!env[key]) env[key] = val;
      }
    }
  }
  return env;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png'
};

const env = loadEnv();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API Routes
  if (req.method === 'POST' && (url.pathname === '/api/route-search' || url.pathname === '/api/detour')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    const webReq = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody
    });

    const handler = url.pathname === '/api/route-search' ? routeSearchPost : detourPost;
    const webResp = await handler({ request: webReq, env });
    res.writeHead(webResp.status, Object.fromEntries(webResp.headers.entries()));
    res.end(await webResp.text());
    return;
  }

  // Static Files
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n[길맛 v2.0 로컬 서버 실행 중] http://localhost:${PORT}`);
  console.log(`- KAKAO_REST_API_KEY: ${env.KAKAO_REST_API_KEY ? '설정됨' : '미설정 (.env 확인 필요)'}`);
  console.log(`- GOOGLE_PLACES_API_KEY: ${env.GOOGLE_PLACES_API_KEY ? '설정됨' : '미설정 (평점 제외 탐색)'}`);
  console.log(`- TOUR_API_KEY: ${env.TOUR_API_KEY ? '설정됨' : '선택 사항 (미설정)'}\n`);
});
