// Cloudflare Pages Function: POST /api/reverse-geocode
// 브라우저 GPS 좌표(lat, lng)를 카카오 로컬 coord2address로 한국어 도로명/지번 주소로 변환

export async function onRequestPost(context) {
  const { request, env } = context;
  const kakaoKey = env && env.KAKAO_REST_API_KEY ? String(env.KAKAO_REST_API_KEY).trim() : '';

  if (!kakaoKey) {
    return jsonResponse({ error: 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.' }, 500);
  }

  try {
    const body = await request.json();
    const lat = Number(body && body.lat);
    const lng = Number(body && body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return jsonResponse({ error: '유효한 위도·경도 좌표가 필요합니다.' }, 400);
    }

    const url = 'https://dapi.kakao.com/v2/local/geo/coord2address.json?x=' + encodeURIComponent(String(lng)) + '&y=' + encodeURIComponent(String(lat));
    const resp = await fetch(url, {
      headers: { Authorization: 'KakaoAK ' + kakaoKey }
    });
    if (!resp.ok) {
      return jsonResponse({ error: '현위치 주소 변환 실패 (HTTP ' + String(resp.status) + ')' }, 502);
    }

    const data = await resp.json();
    const doc = data && data.documents ? data.documents[0] : null;
    const roadAddr = doc && doc.road_address ? doc.road_address.address_name : '';
    const lotAddr = doc && doc.address ? doc.address.address_name : '';
    const address = roadAddr || lotAddr || (lat.toFixed(5) + ', ' + lng.toFixed(5));

    return jsonResponse({ address, lat, lng });
  } catch (err) {
    return jsonResponse({ error: (err && err.message) || '현위치 변환 중 오류가 발생했습니다.' }, 500);
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
