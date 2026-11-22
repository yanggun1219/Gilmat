```javascript
// Cloudflare Pages Function: POST /api/route-search
// Cloudflare 무료 플랜 서브요청 한도(요청당 최대 50회)를 엄격히 준수하는 3-레이어 파이프라인:
// - 지오코딩 2회 + 길찾기 1회 + 카카오 로컬 최대 18회(6구간 x 3카테고리) + Google 평점 보강 최대 22회 = 최대 43회 (< 50회)

const HIGHWAY_PATTERN = /(고속도로|도시고속|강변북로|올림픽대로|내부순환|외곽순환|제2경인|경인고속|대교|터널)/;
const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours',
  'places.googleMapsUri'
].join(',');

export async function onRequestPost(context) {
  const { request, env } = context;
  const kakaoKey = env.KAKAO_REST_API_KEY;
  const googleKey = env.GOOGLE_PLACES_API_KEY || '';

  if (!kakaoKey) {
    return jsonResponse({ error: 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.' }, 500);
  }

  const apiCalls = {
    kakaoLocal: 0,
    kakaoDirections: 0,
    googleEnterprise: 0,
    tourApi: 0
  };

  try {
    const body = await request.json();
    const originQuery = (body?.origin || '').trim();
    const destQuery = (body?.destination || '').trim();
    const keyword = (body?.keyword || '').trim();
    const categories = Array.isArray(body?.categories) && body.categories.length > 0
      ? body.categories
      : ['food', 'cafe', 'play'];
    const enrichRatings = body?.enrichRatings !== false && Boolean(googleKey);

    if (!originQuery || !destQuery) {
      return jsonResponse({ error: '출발지와 목적지를 모두 입력해 주세요.' }, 400);
    }

    // 1. Geocode Origin & Destination (2 subrequests)
    const [origin, destination] = await Promise.all([
      geocodeKakao(originQuery, kakaoKey, apiCalls),
      geocodeKakao(destQuery, kakaoKey, apiCalls)
    ]);

    if (!origin) return jsonResponse({ error: `출발지를 찾을 수 없습니다: ${originQuery}` }, 404);
    if (!destination) return jsonResponse({ error: `목적지를 찾을 수 없습니다: ${destQuery}` }, 404);

    // 2. Driving Route Polyline (1 subrequest)
    const dirParams = new URLSearchParams({
      origin: `${origin.lng},${origin.lat}`,
      destination: `${destination.lng},${destination.lat}`,
      priority: 'RECOMMEND'
    });
    apiCalls.kakaoDirections += 1;
    const dirResp = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${dirParams}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` }
    });
    if (!dirResp.ok) {
      const txt = await dirResp.text();
      return jsonResponse({ error: `카카오 길찾기 호출 실패 (${dirResp.status})`, detail: txt }, 502);
    }
    const dirData = await dirResp.json();
    const mainRoute = dirData?.routes?.[0];
    if (!mainRoute || mainRoute.result_code !== 0) {
      return jsonResponse({ error: mainRoute?.result_msg || '자동차 경로를 계산할 수 없습니다.' }, 422);
    }

    const totalDistanceM = mainRoute.summary?.distance || 0;
    const totalDurationSec = mainRoute.summary?.duration || 0;
    const { polyline, roadPoints } = extractRoutePoints(mainRoute);

    // 3. Adaptive Corridor & IC Sampling (strictly max 6 well-spaced nodes for Cloudflare 50-subrequest safety)
    const samplingNodes = buildAdaptiveSamplingNodes(roadPoints, 6);

    // 4. Parallel Kakao Local Discovery (max 6*3 = 18 subrequests, or 6 when keyword is provided)
    const placeMap = new Map();
    const failedNodeIdx = new Set();

    const kakaoTasks = [];
    samplingNodes.forEach((node, idx) => {
      if (keyword) {
        kakaoTasks.push(
          fetchKakaoKeywordOnce(node, keyword, kakaoKey, apiCalls)
            .then((docs) => docs.forEach((doc) => mergeKakaoDoc(placeMap, doc, inferCategory(doc))))
            .catch(() => { failedNodeIdx.add(idx); })
        );
      } else {
        const codes = [];
        if (categories.includes('food')) codes.push({ code: 'FD6', cat: 'food' });
        if (categories.includes('cafe')) codes.push({ code: 'CE7', cat: 'cafe' });
        if (categories.includes('play')) codes.push({ code: 'AT4', cat: 'play' });

        for (const { code, cat } of codes) {
          kakaoTasks.push(
            fetchKakaoCategoryOnce(node, code, kakaoKey, apiCalls)
              .then((docs) => docs.forEach((doc) => mergeKakaoDoc(placeMap, doc, cat)))
              .catch(() => { failedNodeIdx.add(idx); })
          );
        }
      }
    });

    await Promise.all(kakaoTasks);

    // 5. Stage 1 Fast Corridor Geometry & IC-Trap Scoring
    const allCandidates = Array.from(placeMap.values()).map((p) => {
      const nearest = findNearestRoadPoint(p.lat, p.lng, roadPoints);
      const directKm = Number(nearest.distKm.toFixed(2));
      const progressMin = Math.round((nearest.progressRatio * totalDurationSec) / 60);
      const icTrap = nearest.isHighway && directKm > 1.2;
      const estimatedDetourMin = Math.max(
        2,
        Math.round(directKm * 3.5 + (icTrap ? 11 : 1.5))
      );
      return {
        ...p,
        directKm,
        progressMin,
        icTrap,
        icTrapReason: icTrap ? `고속도로·전용도로(${nearest.roadName || '고속구간'}) 인접 구간으로 IC 우회 필요` : '',
        detourMin: estimatedDetourMin,
        detourVerified: false
      };
    });

    allCandidates.sort((a, b) => a.detourMin - b.detourMin);
    const corridorPlaces = allCandidates.filter((p) => p.directKm <= 5.5);

    // 6. Stage 2 Google Places API (New) Enrichment within remaining subrequest budget (<= 45 total)
    const usedSubrequests = apiCalls.kakaoLocal + apiCalls.kakaoDirections;
    const googleBudget = Math.max(0, Math.min(24, 45 - usedSubrequests));

    if (enrichRatings && googleBudget > 0 && corridorPlaces.length > 0) {
      // Pick balanced targets across food, cafe, play so every tab gets ratings
      const targets = pickBalancedTargets(corridorPlaces, googleBudget);
      await runBatched(targets, 5, async (place) => {
        const g = await enrichWithGooglePlaces(place, googleKey, apiCalls);
        if (g) {
          place.googlePlaceId = g.id || null;
          place.rating = typeof g.rating === 'number' ? g.rating : null;
          place.reviews = g.userRatingCount || 0;
          place.googleMapsUri = g.googleMapsUri || null;
          if (g.regularOpeningHours) {
            place.hoursText = (g.regularOpeningHours.weekdayDescriptions || []).join(' / ') || place.hoursText;
            place.googlePeriods = g.regularOpeningHours.periods || null;
          }
          place.source = '카카오 로컬 + Google';
        }
      });
    }

    const matchedCount = corridorPlaces.filter((p) => p.rating !== null).length;

    return jsonResponse({
      route: {
        origin,
        destination,
        distanceKm: Number((totalDistanceM / 1000).toFixed(1)),
        durationMin: Math.round(totalDurationSec / 60),
        durationSec: totalDurationSec,
        polyline
      },
      samplingNodes,
      coverage: {
        totalNodes: samplingNodes.length,
        completedNodes: Math.max(0, samplingNodes.length - failedNodeIdx.size),
        failedNodes: failedNodeIdx.size,
        totalFound: corridorPlaces.length,
        ratingMatched: matchedCount,
        unrated: corridorPlaces.length - matchedCount,
        googleEnabled: Boolean(googleKey)
      },
      places: corridorPlaces,
      apiCalls
    });
  } catch (err) {
    return jsonResponse({ error: err?.message || '경로 탐색 처리 중 오류가 발생했습니다.' }, 500);
  }
}

function pickBalancedTargets(places, budget) {
  const byCat = { food: [], cafe: [], play: [] };
  for (const p of places) {
    if (byCat[p.category]) byCat[p.category].push(p);
  }
  const picked = [];
  const used = new Set();
  const order = ['food', 'cafe', 'play'];
  let idx = 0;
  while (picked.length < budget) {
    let added = false;
    for (const cat of order) {
      if (picked.length >= budget) break;
      const item = byCat[cat][idx];
      if (item && !used.has(item.id)) {
        used.add(item.id);
        picked.push(item);
        added = true;
      }
    }
    if (!added) break;
    idx += 1;
  }
  return picked;
}

async function geocodeKakao(query, kakaoKey, apiCalls) {
  apiCalls.kakaoLocal += 1;
  const kwUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`;
  const kwResp = await fetch(kwUrl, { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
  if (kwResp.ok) {
    const kwData = await kwResp.json();
    const doc = kwData?.documents?.[0];
    if (doc) {
      return {
        name: doc.place_name || query,
        address: doc.road_address_name || doc.address_name || query,
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x)
      };
    }
  }
  apiCalls.kakaoLocal += 1;
  const addrUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=1`;
  const addrResp = await fetch(addrUrl, { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
  if (addrResp.ok) {
    const addrData = await addrResp.json();
    const doc = addrData?.documents?.[0];
    if (doc) {
      return {
        name: query,
        address: doc.road_address?.address_name || doc.address?.address_name || query,
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x)
      };
    }
  }
  return null;
}

function extractRoutePoints(route) {
  const polyline = [];
  const roadPoints = [];
  let cumulativeM = 0;

  for (const section of route.sections || []) {
    for (const road of section.roads || []) {
      const roadName = road.name || '';
      const isHighway = HIGHWAY_PATTERN.test(roadName);
      const v = road.vertexes || [];
      for (let i = 0; i < v.length; i += 2) {
        const lng = v[i];
        const lat = v[i + 1];
        if (polyline.length > 0) {
          const prev = polyline[polyline.length - 1];
          cumulativeM += haversineKm(prev[0], prev[1], lat, lng) * 1000;
        }
        polyline.push([lat, lng]);
        roadPoints.push({ lat, lng, roadName, isHighway, cumulativeM });
      }
    }
  }

  const totalM = Math.max(1, cumulativeM);
  for (const pt of roadPoints) {
    pt.progressRatio = pt.cumulativeM / totalM;
  }

  const step = Math.max(1, Math.floor(polyline.length / 200));
  const slimPolyline = polyline.filter((_, idx) => idx % step === 0 || idx === polyline.length - 1);
  return { polyline: slimPolyline, roadPoints };
}

function buildAdaptiveSamplingNodes(roadPoints, maxNodes = 6) {
  if (roadPoints.length === 0) return [];
  if (roadPoints.length <= maxNodes) {
    return roadPoints.map((pt, i) => ({
      name: pt.roadName || `구간 ${i + 1}`,
      lat: pt.lat,
      lng: pt.lng,
      radius: 3000,
      type: pt.isHighway ? 'ic' : 'urban'
    }));
  }

  // Evenly distribute 6 anchor points by cumulative route progress (0%, 20%, 40%, 60%, 80%, 100%)
  const nodes = [];
  for (let k = 0; k < maxNodes; k++) {
    const targetRatio = k / (maxNodes - 1);
    let bestPt = roadPoints[0];
    let bestDiff = 999;
    for (let i = 0; i < roadPoints.length; i++) {
      const diff = Math.abs(roadPoints[i].progressRatio - targetRatio);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPt = roadPoints[i];
      }
    }
    nodes.push({
      name: bestPt.roadName || (k === 0 ? '출발권' : k === maxNodes - 1 ? '목적지권' : `경로 ${k + 1}구간`),
      lat: bestPt.lat,
      lng: bestPt.lng,
      radius: bestPt.isHighway ? 4000 : 3000,
      type: bestPt.isHighway ? 'ic' : 'urban'
    });
  }
  return nodes;
}

async function fetchKakaoCategoryOnce(node, categoryCode, kakaoKey, apiCalls) {
  apiCalls.kakaoLocal += 1;
  const params = new URLSearchParams({
    category_group_code: categoryCode,
    x: String(node.lng),
    y: String(node.lat),
    radius: String(node.radius),
    size: '15',
    page: '1',
    sort: 'distance'
  });
  const resp = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` }
  });
  if (!resp.ok) throw new Error(`Kakao category ${resp.status}`);
  const data = await resp.json();
  return data.documents || [];
}

async function fetchKakaoKeywordOnce(node, keyword, kakaoKey, apiCalls) {
  apiCalls.kakaoLocal += 1;
  const params = new URLSearchParams({
    query: keyword,
    x: String(node.lng),
    y: String(node.lat),
    radius: String(Math.min(5000, node.radius + 1000)),
    size: '15',
    page: '1',
    sort: 'distance'
  });
  const resp = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` }
  });
  if (!resp.ok) throw new Error(`Kakao keyword ${resp.status}`);
  const data = await resp.json();
  return data.documents || [];
}

function inferCategory(doc) {
  const code = doc.category_group_code || '';
  if (code === 'CE7') return 'cafe';
  if (code === 'AT4' || code === 'CT1') return 'play';
  return 'food';
}

function mergeKakaoDoc(placeMap, doc, category) {
  if (!doc || !doc.id || placeMap.has(doc.id)) return;
  const catParts = (doc.category_name || '').split('>').map((s) => s.trim()).filter(Boolean);
  const tags = catParts.slice(1, 4);
  const addr = doc.road_address_name || doc.address_name || '';
  const zone = addr.split(' ').slice(0, 3).join(' ');

  placeMap.set(doc.id, {
    id: doc.id,
    name: doc.place_name,
    category,
    zone: zone || '경로 주변',
    address: addr,
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    phone: doc.phone || '',
    kakaoUrl: doc.place_url || '',
    rating: null,
    reviews: 0,
    freeParking: false,
    parkingNote: '카카오맵·구글맵 상세에서 확인',
    tags: tags.length > 0 ? tags : [category === 'cafe' ? '카페' : category === 'play' ? '놀거리' : '음식점'],
    source: '카카오 로컬 (Google 미확인)',
    hoursText: '영업시간 미확인(상세 링크 확인)',
    googlePeriods: null
  });
}

async function enrichWithGooglePlaces(place, googleKey, apiCalls) {
  apiCalls.googleEnterprise += 1;
  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleKey,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK
      },
      body: JSON.stringify({
        textQuery: `${place.name} ${place.zone}`,
        languageCode: 'ko',
        maxResultCount: 1,
        locationBias: {
          circle: {
            center: { latitude: place.lat, longitude: place.lng },
            radius: 300.0
          }
        }
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.places?.[0] || null;
  } catch {
    return null;
  }
}

function findNearestRoadPoint(lat, lng, roadPoints) {
  let best = { distKm: 999, progressRatio: 0.5, isHighway: false, roadName: '' };
  const step = Math.max(1, Math.floor(roadPoints.length / 220));
  for (let i = 0; i < roadPoints.length; i += step) {
    const pt = roadPoints[i];
    const d = haversineKm(lat, lng, pt.lat, pt.lng);
    if (d < best.distKm) {
      best = {
        distKm: d,
        progressRatio: pt.progressRatio,
        isHighway: pt.isHighway,
        roadName: pt.roadName
      };
    }
  }
  return best;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runBatched(items, concurrency, fn) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = items[index++];
      await fn(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
```
