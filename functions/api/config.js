// Cloudflare Pages Function: GET /api/config
// 브라우저에서 카카오맵 JavaScript SDK를 로드하기 위해 Cloudflare 환경변수의 KAKAO_JS_KEY를 안전하게 전달

export async function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      kakaoJsKey: (env && env.KAKAO_JS_KEY) ? String(env.KAKAO_JS_KEY).trim() : '',
      hasKakaoRest: Boolean(env && env.KAKAO_REST_API_KEY),
      hasGooglePlaces: Boolean(env && env.GOOGLE_PLACES_API_KEY)
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}
