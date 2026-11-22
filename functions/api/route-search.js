// Cloudflare Pages Function: POST /api/route-search
// 3-레이어 하이브리드 파이프라인:
// 1) 카카오 로컬 지오코딩 + 카카오모빌리티 자동차 길찾기 폴리라인 추출
// 2) 도로 유형별(도심/고속도로 IC) 적응형 샘플링 + 카카오 로컬(카테고리/메뉴 키워드) + TourAPI 실시간 수집
// 3) 1차 거리·IC 컷 후 Google Places API (New) Enterprise FieldMask로 평점·평가 수·정규 영업시간 결합

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
  const tourKey = env.TOUR_API_KEY || '';
  const maxGoogleEnrich = Math.min(80, parseInt(env.MAX_GOOGLE_ENRICH_PER_SEARCH || '35', 10) || 35);

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

    // 1. Geocode Origin & Destination
    const [origin, destination] = await Promise.all([
      geocodeKakao(originQuery, kakaoKey, apiCalls),
      geocodeKakao(destQuery, kakaoKey, apiCalls)
    ]);

    if (!origin) return jsonResponse({ error: `출발지를 찾을 수 없습니다: ${originQuery}` }, 404);
    if (!destination) return jsonResponse({ error: `목적지를 찾을 수 없습니다: ${destQuery}` }, 404);

    // 2. Driving Route Polyline (Kakao Mobility Directions)
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

    // 3. Adaptive Corridor & IC Sampling
    const samplingNodes = buildAdaptiveSamplingNodes(roadPoints, totalDurationSec);

    // 4. Parallel Place Discovery (Kakao Local + Optional TourAPI)
    const placeMap = new Map();
    let failedNodes = 0;

    const kakaoTasks = [];
    for (const node of samplingNodes) {
      if (keyword) {
        kakaoTasks.push(
          fetchKakaoKeyword(node, keyword, kakaoKey, apiCalls)
            .then((docs) => docs.forEach((doc) => mergeKakaoDoc(placeMap, doc, inferCategory(doc))))
            .catch(() => { failedNodes += 1; })
        );
      } else {
        const codes = [];
        if (categories.includes('food')) codes.push({ code: 'FD6', cat: 'food' });
        if (categories.includes('cafe')) codes.push({ code: 'CE7', cat: 'cafe' });
        if (categories.includes('play')) {
          codes.push({ code: 'AT4', cat: 'play' });
          codes.push({ code: 'CT1', cat: 'play' });
        }
        for (const { code, cat } of codes) {
          kakaoTasks.push(
            fetchKakaoCategory(node, code, kakaoKey, apiCalls)
              .then((docs) => docs.forEach((doc) => mergeKakaoDoc(placeMap, doc, cat)))
              .catch(() => { failedNodes += 1; })
          );
        }
      }
    }

    // Optional TourAPI for attractions when keyword is empty or play is selected
    const tourTasks = [];
    if (tourKey && categories.includes('play') && !keyword) {
      const sparseNodes = samplingNodes.filter((_, idx) => idx % 2 === 0).slice(0, 5);
      for (const node of sparseNodes) {
        tourTasks.push(
          fetchTourApiNearby(node, tourKey, apiCalls)
            .then((items) => items.forEach((item) => mergeTourItem(placeMap, item)))
            .catch(() => {})
        );
      }
    }

    await Promise.all([...kakaoTasks, ...tourTasks]);

    // 5. Stage 1 Fast Corridor Geometry & IC-Trap Scoring
    const allCandidates = Array.from(placeMap.values()).map((p) => {
      const nearest = findNearestRoadPoint(p.lat, p.lng, roadPoints);
      const directKm = Number(nearest.distKm.toFixed(2));
      const progressMin = Math.round((nearest.progressRatio * totalDurationSec) / 60);
      const icTrap = nearest.isHighway && directKm > 1.1;
      const estimatedDetourMin = Math.max(
        2,
        Math.round(directKm * 3.6 + (icTrap ? 11 : 1.5))
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

    // Keep candidates within reasonable 5km corridor and sort by detour
    allCandidates.sort((a, b) => a.detourMin - b.detourMin);
    const corridorPlaces = allCandidates.filter((p) => p.directKm <= 5.0);

    // 6. Stage 2 Google Places API (New) Enterprise Rating & Opening Hours Enrichment
    if (enrichRatings && corridorPlaces.length > 0) {
      const targets = corridorPlaces.slice(0, maxGoogleEnrich);
      await runBatched(targets, 6, async (place) => {
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
          place.source = place.source.includes('TourAPI') ? 'TourAPI + Google' : '카카오 로컬 + Google';
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
        completedNodes: Math.max(0, samplingNodes.length - failedNodes),
        failedNodes,
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

async function geocodeKakao(query, kakaoKey, apiCalls) {
  // Try keyword search first (handles POI names like "인천공항 제1여객터미널" and addresses)
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
  // Fallback to address search
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

  // Downsample polyline for lighter map rendering while preserving shape
  const step = Math.max(1, Math.floor(polyline.length / 220));
  const slimPolyline = polyline.filter((_, idx) => idx % step === 0 || idx === polyline.length - 1);
  return { polyline: slimPolyline, roadPoints };
}

function buildAdaptiveSamplingNodes(roadPoints) {
  if (roadPoints.length === 0) return [];
  const nodes = [];
  let lastAdded = null;

  for (let i = 0; i < roadPoints.length; i++) {
    const pt = roadPoints[i];
    const prev = i > 0 ? roadPoints[i - 1] : null;
    const isTransition = prev && prev.isHighway !== pt.isHighway; // Highway IC entry/exit transition

    if (!lastAdded) {
      nodes.push({
        name: pt.roadName || '출발 구간',
        lat: pt.lat,
        lng: pt.lng,
        radius: 2200,
        type: pt.isHighway ? 'ic' : 'urban'
      });
      lastAdded = pt;
      continue;
    }

    const distKm = haversineKm(lastAdded.lat, lastAdded.lng, pt.lat, pt.lng);
    // Prioritize IC transition points; use wider interval on highways, tighter on urban roads
    const thresholdKm = isTransition ? 1.8 : (pt.isHighway ? 6.5 : 3.5);
    if (distKm >= thresholdKm && nodes.length < 14) {
      nodes.push({
        name: pt.roadName || (isTransition ? '고속도로 IC 인근' : '경로 구간'),
        lat: pt.lat,
        lng: pt.lng,
        radius: pt.isHighway || isTransition ? 3200 : 2300,
        type: pt.isHighway || isTransition ? 'ic' : 'urban'
      });
      lastAdded = pt;
    }
  }

  // Always include destination vicinity
  const endPt = roadPoints[roadPoints.length - 1];
  if (lastAdded && haversineKm(lastAdded.lat, lastAdded.lng, endPt.lat, endPt.lng) > 1.5) {
    nodes.push({
      name: '목적지 인근',
      lat: endPt.lat,
      lng: endPt.lng,
      radius: 2500,
      type: 'urban'
    });
  }

  return nodes;
}

async function fetchKakaoCategory(node, categoryCode, kakaoKey, apiCalls) {
  const results = [];
  for (let page = 1; page <= 2; page++) {
    apiCalls.kakaoLocal += 1;
    const params = new URLSearchParams({
      category_group_code: categoryCode,
      x: String(node.lng),
      y: String(node.lat),
      radius: String(node.radius),
      size: '15',
      page: String(page),
      sort: 'distance'
    });
    const resp = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` }
    });
    if (!resp.ok) break;
    const data = await resp.json();
    results.push(...(data.documents || []));
    if (data.meta?.is_end) break;
  }
  return results;
}

async function fetchKakaoKeyword(node, keyword, kakaoKey, apiCalls) {
  const results = [];
  for (let page = 1; page <= 2; page++) {
    apiCalls.kakaoLocal += 1;
    const params = new URLSearchParams({
      query: keyword,
      x: String(node.lng),
      y: String(node.lat),
      radius: String(Math.min(5000, node.radius + 800)),
      size: '15',
      page: String(page),
      sort: 'distance'
    });
    const resp = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` }
    });
    if (!resp.ok) break;
    const data = await resp.json();
    results.push(...(data.documents || []));
    if (data.meta?.is_end) break;
  }
  return results;
}

async function fetchTourApiNearby(node, tourKey, apiCalls) {
  apiCalls.tourApi += 1;
  const params = new URLSearchParams({
    serviceKey: tourKey,
    numOfRows: '10',
    pageNo: '1',
    MobileOS: 'ETC',
    MobileApp: 'Gilmat',
    _type: 'json',
    mapX: String(node.lng),
    mapY: String(node.lat),
    radius: String(Math.min(4000, node.radius)),
    contentTypeId: '12' // 관광지
  });
  const resp = await fetch(`https://apis.data.go.kr/B551011/KorService2/locationBasedList2?${params}`);
  if (!resp.ok) return [];
  const data = await resp.json();
  const items = data?.response?.body?.items?.item;
  return Array.isArray(items) ? items : [];
}

function inferCategory(doc) {
  const code = doc.category_group_code || '';
  if (code === 'CE7') return 'cafe';
  if (code === 'AT4' || code === 'CT1') return 'play';
  return 'food';
}

function mergeKakaoDoc(placeMap, doc, category) {
  if (!doc || !doc.id) return;
  if (placeMap.has(doc.id)) return;
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

function mergeTourItem(placeMap, item) {
  const id = `tour_${item.contentid}`;
  if (!item.contentid || placeMap.has(id)) return;
  const lat = parseFloat(item.mapy);
  const lng = parseFloat(item.mapx);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  placeMap.set(id, {
    id,
    name: item.title,
    category: 'play',
    zone: (item.addr1 || '').split(' ').slice(0, 3).join(' ') || '관광지',
    address: item.addr1 || '',
    lat,
    lng,
    phone: item.tel || '',
    kakaoUrl: '',
    rating: null,
    reviews: 0,
    freeParking: false,
    parkingNote: '관광지 상세에서 확인',
    tags: ['관광명소', 'TourAPI'],
    source: 'TourAPI (Google 미확인)',
    hoursText: '운영시간 상세 확인 권장',
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
            radius: 250.0
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
  const step = Math.max(1, Math.floor(roadPoints.length / 260));
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
