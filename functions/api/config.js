// Cloudflare Pages Function: GET /api/config
export async function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      kakaoJsKey: (env && env.KAKAO_JS_KEY) ? String(env.KAKAO_JS_KEY).trim() : '',
      hasKakaoRest: Boolean(env && env.KAKAO_REST_API_KEY),
      hasGooglePlaces: Boolean(env && env.GOOGLE_PLACES_API_KEY),
      hasTmap: Boolean(env && env.TMAP_APP_KEY)
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
