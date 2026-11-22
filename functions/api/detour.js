// Cloudflare Pages Function: POST /api/detour
// 특정 후보 장소 1곳을 경유지로 넣었을 때의 정밀 우회시간(분) 계산

export async function onRequestPost(context) {
  const { request, env } = context;
  const kakaoKey = env.KAKAO_REST_API_KEY;

  if (!kakaoKey) {
    return jsonResponse({ error: 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.' }, 500);
  }

  try {
    const body = await request.json();
    const { origin, destination, waypoint, baseDurationSec } = body || {};
    if (!origin || !destination || !waypoint) {
      return jsonResponse({ error: 'origin, destination, waypoint 좌표가 필요합니다.' }, 400);
    }

    const params = new URLSearchParams({
      origin: `${origin.lng},${origin.lat}`,
      destination: `${destination.lng},${destination.lat}`,
      waypoints: `${waypoint.lng},${waypoint.lat}`,
      priority: 'RECOMMEND'
    });

    const resp = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${params}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` }
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return jsonResponse({ error: `카카오 길찾기 오류 (${resp.status})`, detail: txt }, 502);
    }

    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route || route.result_code !== 0) {
      return jsonResponse({ error: route?.result_msg || '경유 경로를 계산할 수 없습니다.' }, 422);
    }

    const viaDurationSec = route.summary?.duration || 0;
    const viaDistanceM = route.summary?.distance || 0;
    const diffSec = Math.max(0, viaDurationSec - (baseDurationSec || 0));
    const detourMin = Math.round(diffSec / 60);

    return jsonResponse({
      detourMin,
      viaDurationMin: Math.round(viaDurationSec / 60),
      viaDistanceKm: Number((viaDistanceM / 1000).toFixed(1)),
      apiCalls: { kakaoDirections: 1 }
    });
  } catch (err) {
    return jsonResponse({ error: err?.message || '우회시간 계산 중 오류가 발생했습니다.' }, 500);
  }
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
