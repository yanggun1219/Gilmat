// 길맛 유명맛집 자동 업데이트 스크립트 (Node 20+ 내장 fetch 사용, 외부 패키지 불필요)
// 실행: node scripts/update-curated.mjs
import fs from 'node:fs';
import path from 'node:path';

const JSON_PATH = path.resolve('public/curated-places.json');
const ROUTE_JS_PATH = path.resolve('functions/api/route-search.js');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9'
};

function normName(s) {
  return String(s || '').replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();
}

function inferRegion(area) {
  const first = String(area || '').trim().split(/\s+/)[0] || '기타';
  return first.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '');
}

async function fetchText(url) {
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
  return await resp.text();
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// zigzangin.com 테이블/카드 파서 (먹을텐데 · 최자로드)
async function fetchZigzangin(url, sourceLabel) {
  const html = await fetchText(url);
  const found = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRegex.exec(html)) !== null) {
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = tdRegex.exec(m[1])) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (cells.length >= 2) {
      const name = cells[0];
      const area = cells[1];
      const menu = cells[2] || '';
      if (name && area && name.length <= 40 && /[가-힣]/.test(area)) {
        found.push({
          name,
          region: inferRegion(area),
          area,
          cuisine: '음식점',
          menu,
          sources: [sourceLabel]
        });
      }
    }
  }
  return found;
}

// 나무위키 또간집 방영 목록 파서 (IDC IP 차단 시 안전하게 기존 데이터 유지)
async function fetchTtoganjip() {
  const html = await fetchText('https://namu.wiki/w/%EB%98%90%EA%B0%84%EC%A7%91');
  if (html.includes('IDC 대역 차단') && !html.includes('EP.1')) {
    throw new Error('Namuwiki blocked cloud runner IP');
  }
  const found = [];
  const skipWords = ['보류', '재보류', '없음', '선정 취소', '-'];
  const overseas = ['홍콩', '방콕', '오사카', '교토', '일본', '태국'];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRegex.exec(html)) !== null) {
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = tdRegex.exec(m[1])) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (cells.length >= 4 && /^EP\.\d+$/i.test(cells[0])) {
      const title = cells[2] || '';
      const rawPlace = (cells[3] || '').replace(/\[\d+\]/g, '').trim();
      if (!rawPlace || skipWords.includes(rawPlace)) continue;
      if (overseas.some((w) => title.includes(w))) continue;
      found.push({
        name: rawPlace,
        region: '전국',
        area: title.slice(0, 24),
        cuisine: '음식점',
        menu: '',
        sources: ['또간집']
      });
    }
  }
  return found;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const places = Array.isArray(existing.places) ? existing.places : [];
  const byKey = new Map();
  places.forEach((p) => {
    byKey.set(normName(p.name), p);
  });

  let addedCount = 0;
  const tasks = [
    { label: '먹을텐데', fn: () => fetchZigzangin('https://zigzangin.com/meokeultende', '먹을텐데') },
    { label: '최자로드', fn: () => fetchZigzangin('https://zigzangin.com/choija-road', '최자로드') },
    { label: '또간집', fn: () => fetchTtoganjip() }
  ];

  for (const t of tasks) {
    try {
      const items = await t.fn();
      console.log('[' + t.label + '] fetched ' + items.length + ' rows');
      items.forEach((item) => {
        const k = normName(item.name);
        if (!k) return;
        const prev = byKey.get(k);
        if (prev) {
          if (!prev.sources.includes(t.label)) {
            prev.sources.push(t.label);
            addedCount += 1;
          }
        } else {
          byKey.set(k, item);
          places.push(item);
          addedCount += 1;
        }
      });
    } catch (err) {
      console.log('[' + t.label + '] skipped safely:', err.message);
    }
  }

  if (addedCount === 0) {
    console.log('No new curated places found. Keeping existing files unchanged.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const nextJson = {
    updated: today,
    count: places.length,
    sources: ['먹을텐데', '최자로드', '또간집'],
    places
  };
  fs.writeFileSync(JSON_PATH, JSON.stringify(nextJson, null, 2) + '\n', 'utf8');

  if (fs.existsSync(ROUTE_JS_PATH)) {
    const rs = fs.readFileSync(ROUTE_JS_PATH, 'utf8');
    const compact = places.map((p) => [p.name, p.area, p.menu || '', p.sources || []]);
    const replacement = '// CURATED_DB_START\nconst CURATED_DB = ' + JSON.stringify(compact) + ';\n// CURATED_DB_END';
    const nextRs = rs.replace(/\/\/ CURATED_DB_START[\s\S]*?\/\/ CURATED_DB_END/, replacement);
    fs.writeFileSync(ROUTE_JS_PATH, nextRs, 'utf8');
  }

  console.log('Updated curated places! Added/merged:', addedCount, 'Total:', places.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
