// Cloudflare Pages Function: POST /api/route-search
// 차량(카카오) · 도보(TMAP) + 경로상 먹을텐데·최자로드·또간집 유명맛집 능동 탐색 + Google 평점 결합 (백틱 미사용 안전 버전)

const HIGHWAY_PATTERN = /(고속도로|도시고속|강변북로|올림픽대로|내부순환|외곽순환|제2경인|경인고속|대교|터널)/;
const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours',
  'places.googleMapsUri'
].join(',');

// [상호명, 지역, 대표메뉴, 출처배열]
// CURATED_DB_START
const CURATED_DB = [["딸랏", "서울 강남구 신사동", "", ["먹을텐데"]], ["스시스미레", "서울 강남구 청담동", "", ["먹을텐데"]], ["와일드버팔로", "서울 강남구 신사동", "", ["먹을텐데"]], ["진미평양냉면", "서울 강남구 논현동", "평양냉면", ["먹을텐데"]], ["홍명", "서울 강남구 논현동", "", ["먹을텐데"]], ["발산한우진곱창", "서울 강서구 마곡동", "곱창", ["먹을텐데"]], ["샤오롱바오", "서울 광진구 자양동", "샤오롱바오", ["먹을텐데"]], ["안동집 손칼국시", "서울 동대문구 제기동", "칼국수", ["먹을텐데"]], ["충북순대", "서울 동작구 흑석동", "순대국", ["먹을텐데"]], ["국일순대국", "서울 마포구 월드컵북로5길", "순대국", ["먹을텐데"]], ["부영각", "서울 마포구 용강동", "", ["먹을텐데"]], ["이품", "서울 서대문구 연희동", "", ["먹을텐데"]], ["영동설렁탕", "서울 서초구 잠원동", "설렁탕", ["먹을텐데"]], ["하이콴", "서울 서초구 신반포로", "", ["먹을텐데"]], ["한신치킨호프", "서울 서초구 신반포로23길", "", ["먹을텐데"]], ["매치스성수", "서울 성동구 성수동2가", "", ["먹을텐데"]], ["성수아구찜", "서울 성동구 왕십리로8길", "아구찜", ["먹을텐데"]], ["세스크멘슬", "서울 성동구 성수이로14길", "", ["먹을텐데"]], ["별미곱창", "서울 송파구 오금로11길", "곱창", ["먹을텐데"]], ["본가진미간장게장", "서울 송파구 백제고분로", "간장게장", ["먹을텐데"]], ["까치네", "서울 용산구 한강대로84길", "계란범벅·두부김치", ["먹을텐데", "최자로드"]], ["부자피자 1호점", "서울 용산구 한남동", "피자", ["먹을텐데"]], ["야래향", "서울 용산구 이촌동", "", ["먹을텐데"]], ["야스노야 본점", "서울 용산구 후암동", "", ["먹을텐데"]], ["옛날감자전", "서울 용산구 남영동", "", ["먹을텐데"]], ["이조순대국", "서울 용산구 원효로2가", "순대국", ["먹을텐데"]], ["진미식당", "서울 용산구 문배동", "", ["먹을텐데"]], ["대성집", "서울 종로구 행촌동", "도가니탕", ["먹을텐데"]], ["도량", "서울 종로구 통의동", "", ["먹을텐데"]], ["서린낙지", "서울 종로구 종로1가", "낙지볶음", ["먹을텐데"]], ["카페 오쁘띠베르", "서울 종로구 통인동", "", ["먹을텐데"]], ["핏제리아오 대학로 본점", "서울 종로구 동숭길", "피자", ["먹을텐데"]], ["효제루", "서울 종로구 효제동", "", ["먹을텐데"]], ["묵호회집", "서울 중구 북창동", "", ["먹을텐데"]], ["실비식당", "서울 중구 인현동2가", "", ["먹을텐데"]], ["양미옥 남대문점", "서울 중구 남대문로", "", ["먹을텐데"]], ["우래옥", "서울 중구 주교동", "평양냉면·불고기", ["먹을텐데"]], ["인천집", "서울 중구 다동길", "", ["먹을텐데"]], ["필동면옥", "서울 중구 필동3가", "평양냉면", ["먹을텐데"]], ["해남순대국", "서울 중구 신당동", "순대국", ["먹을텐데"]], ["행화촌", "서울 중구 남대문로", "", ["먹을텐데"]], ["향미 명동점", "서울 중구 명동2가", "", ["먹을텐데"]], ["윤밀원", "경기 성남시 분당구 정자동", "", ["먹을텐데"]], ["하남숯불닭갈비 미사본점", "경기 하남시 미사동", "숯불닭갈비", ["먹을텐데"]], ["전원식당", "강원 속초시 동명동", "", ["먹을텐데"]], ["화진호 이선장네", "강원 속초시 교동", "", ["먹을텐데"]], ["태화장", "대전 동구 정동", "", ["먹을텐데"]], ["참조은생고기", "대구 북구 복현동", "", ["먹을텐데"]], ["오두리할매셋째딸연탄쭈꾸미", "부산 사하구 사리로8번길", "연탄 쭈꾸미", ["먹을텐데"]], ["월드양념통닭", "부산 사하구 장림동", "양념통닭", ["먹을텐데"]], ["금손1983", "부산 수영구 수영로680번길", "", ["먹을텐데"]], ["해진아나고구이", "부산 수영구 광안동", "아나고구이", ["먹을텐데"]], ["막동이회관", "광주 동구 소태동", "", ["먹을텐데"]], ["25시소문난오돌뼈 본점", "광주 북구 저불로69번길", "오돌뼈", ["먹을텐데"]], ["돌다메 이호애월본점", "제주 제주시 외도일동", "", ["먹을텐데"]], ["함덕골목 본점", "제주 제주시 조천읍 조천리", "", ["먹을텐데"]], ["해녀촌", "제주 제주시 구좌읍 동복리", "", ["먹을텐데"]], ["서북면옥", "서울 광진구 자양로", "평양냉면", ["최자로드"]], ["순금이 떡볶이", "서울 광진구 자양로43길", "떡볶이·순대·튀김", ["최자로드"]], ["월래순 교자관", "서울 구로구 디지털로19길", "군만두·샤오롱바오", ["최자로드"]], ["고도식 마포점", "서울 마포구", "삼겹살·알등심", ["최자로드"]], ["닭내장집", "서울 서대문구 수색로", "닭발·닭내장탕", ["최자로드"]], ["송강", "서울 서초구 방배동", "복 사시미·황복지리", ["최자로드"]], ["심마니약초백숙", "서울 성동구 성덕정13길", "산약초 닭백숙", ["최자로드"]], ["장미식당", "서울 성동구 금호로", "제육짜글이·된장찌개", ["최자로드"]], ["남영돈", "서울 용산구 한강대로80길", "항정살·가브리살", ["최자로드"]], ["남영탉", "서울 용산구 한강대로80길", "마라 소스 통닭", ["최자로드"]], ["사랑방 참숯화로구이", "서울 용산구 신흥로36길", "갈비살·돼지갈비", ["최자로드"]], ["수저가", "서울 용산구 남영동", "짬뽕·마늘탕수육", ["최자로드"]], ["야스노야지로", "서울 용산구 백범로87길", "양고기 코스", ["최자로드"]], ["한남미수", "서울 용산구 한남동", "회·도미탕", ["최자로드"]], ["황토마당", "서울 용산구 한강대로62나길", "홍어 삼합·홍어탕", ["최자로드"]], ["오죽이네", "서울 종로구 돈화문로11가길", "닭매운탕", ["최자로드"]], ["산수갑산", "서울 중구 을지로20길", "순대국밥·대창순대", ["최자로드"]], ["은주정", "서울 중구 창경궁로8길", "쌈 싸 먹는 김치찌개", ["최자로드"]], ["호수집", "서울 중구 청파로", "닭볶음탕·닭꼬치", ["최자로드"]], ["황평집", "서울 중구 마른내로", "닭무침·닭찜", ["최자로드"]], ["혜장국", "서울 신논현역 인근", "대구식 육개장·수육", ["최자로드"]], ["야반", "경기 이천시 경충대로", "보리굴비 정식", ["최자로드"]], ["오문창순대국밥", "대전 대덕구 한밭대로", "순대국밥", ["최자로드"]], ["등대할매집", "부산 서구 등대로", "장어구이·곰장어", ["최자로드"]], ["도문강", "울산 중구 학성로", "만두·부추계란볶음", ["최자로드"]], ["뉴오더클럽", "서울 마포구 연남동", "포테이토/루꼴라 반반 피자", ["또간집"]], ["라도집", "서울 용산구 한남동", "닭도리탕 백반, 제육볶음, 골뱅이무침", ["또간집"]], ["3시 50분 순대", "서울 종로구 광장시장", "길거리 순대", ["또간집"]], ["성수부두", "서울 성동구 성수동", "조개찜, 칼국수", ["또간집"]], ["유야케도쿄", "서울 서대문구 신촌", "치즈돈까스", ["또간집"]], ["오복순대국", "서울 영등포구 문래동", "순댓국 정식", ["또간집"]], ["왕거미식당", "대구 중구", "뭉티기, 오드레기", ["또간집"]], ["떡도리탕", "서울 강남구 역삼동", "떡도리탕", ["또간집"]], ["토리카미", "서울 중구 을지로", "닭 모듬구이", ["또간집"]], ["자코비버거", "서울 용산구 이태원", "내장 파괴 버거", ["또간집"]], ["카미야", "서울 마포구 홍대", "오코노미소스동", ["또간집"]], ["섬집", "서울 용산구", "육전, 김치찜", ["또간집"]], ["정철 황소곱창", "경기 수원시", "곱창구이, 얼큰라면", ["또간집"]], ["더빛남", "서울 송파구 잠실", "차돌+양지+도가니 쌀국수", ["또간집"]], ["선경 준치횟집", "전남 목포시", "준치 회무침, 붕장어 양념구이", ["또간집"]], ["25시 참숯구이", "광주 북구", "오돌뼈 구이, 된장 삼겹살, 잔치국수", ["또간집"]], ["와타요업", "대전 서구", "텐동", ["또간집"]], ["남동어시장", "인천 남동구", "모듬숙성회, 미역국밥", ["또간집"]], ["송정희어머니 손두부", "강원 속초시", "해물순두부, 순두부", ["또간집"]], ["광평 평양냉면", "서울 강남구 삼성동", "돔베고기, 전복김치, 평양냉면", ["또간집"]], ["신해바라기", "제주 제주시", "순두부찌개", ["또간집"]], ["희신이네", "제주 서귀포시", "닭고기냉밀면, 닭깐풍기", ["또간집"]], ["가양칼국수", "서울 영등포구 여의도", "가양칼국수버섯매운탕", ["또간집"]], ["이유식당", "서울 종로구 대학로", "목살김치찜", ["또간집"]], ["길거리야", "전북 전주시", "바게트 버거", ["또간집"]], ["빼돌린뒷고기", "경북 경주시", "뒷고기 모듬, 물냉면", ["또간집"]], ["세정", "부산 수영구", "한치모밀쟁반", ["또간집"]], ["대흥양다리바베큐", "서울 광진구 건대", "양다리, 꿔바로우, 온면", ["또간집"]], ["산사랑", "경기 용인시", "한정식", ["또간집"]], ["담택", "서울 마포구 합정", "라멘", ["또간집"]], ["백금식당", "전남 여수시", "백반, 서대회무침", ["또간집"]], ["소라편의점식당", "전남 순천시", "두루치기", ["또간집"]], ["무한자금성", "서울 구로구 구로디지털단지", "중식뷔페", ["또간집"]], ["대련집", "서울 종로구", "시골칼국수, 생배추보쌈", ["또간집"]], ["인천식당", "경북 포항시", "두루치기", ["또간집"]], ["함경면옥", "울산 남구", "냉면, 만두", ["또간집"]], ["한양양곱창", "서울 성동구 왕십리", "한 판 모둠, 염통", ["또간집"]], ["이씨식당", "충북 충주시", "쭈꾸미 세트", ["또간집"]], ["돈까스갤러리", "경기 의정부시", "모둠까스", ["또간집"]], ["란주칼면", "서울 중구 명동", "해물볶음 도삭면, 꿔바로우", ["또간집"]], ["밀양집", "부산 중구", "돼지국밥", ["또간집"]], ["버섯집", "서울 성동구 서울숲", "들깨버섯탕", ["또간집"]], ["봉용불고기", "충북 청주시", "돼지고기 불고기", ["또간집"]], ["학곡리막국수닭갈비", "강원 춘천시", "닭갈비, 닭내장", ["또간집"]], ["상운메밀촌", "강원 양양군", "메밀육개장칼국수", ["또간집"]], ["장안회집", "강원 강릉시", "물가자미물회, 우럭미역국", ["또간집"]], ["돌판하나", "경기 성남시 분당구", "흑돼지 김치찌개", ["또간집"]], ["논고을", "서울 동작구 사당동", "갈빗살", ["또간집"]], ["충남집순대", "충남 천안시", "순대 접시, 순대 국밥", ["또간집"]], ["하레하레", "대전 서구", "모둠타르트, 카스테라, 양파빵", ["또간집"]], ["또순이네집", "전북 전주시", "양념불고기", ["또간집"]], ["면마루", "서울 용산구 해방촌", "삼겹살", ["또간집"]], ["대명관", "전남 목포시", "꼬리곰탕", ["또간집"]], ["되뫼골부대찌개", "경남 통영시", "부대전골", ["또간집"]], ["농가의하루", "경기 화성시 동탄", "하와이안 피자, 닭갈비 볶음밥", ["또간집"]], ["부산이화양곱창", "경남 창원시 마산", "소금구이, 곱창전골", ["또간집"]], ["아구훈감", "경남 창원시 진해", "아구불고기", ["또간집"]], ["목포수산", "서울 관악구 신림동", "우럭회, 오징어부추전", ["또간집"]], ["성원농장", "경기 김포시", "삼겹살", ["또간집"]], ["동해오징어보쌈", "경기 안양시", "오징어보쌈", ["또간집"]], ["푸차이로오", "경북 구미시", "팟타이", ["또간집"]], ["신간짬뽕", "경기 파주시", "간짬뽕", ["또간집"]], ["풀뿌리흑두부", "전남 여수시", "보쌈", ["또간집"]], ["명문제과", "전북 남원시", "꿀아몬드빵, 생크림소보로빵, 수제햄빵", ["또간집"]], ["호성식당", "경기 평택시", "꽃게탕", ["또간집"]], ["막내회집", "서울 중구 남대문시장", "회정식", ["또간집"]], ["사직로서울", "서울 종로구 서촌", "참나무소갈비", ["또간집"]], ["오리촌", "경기 남양주시", "오리 숯불꼬치구이", ["또간집"]], ["뚱이네포차", "충남 서산시", "굴보쌈, 고추장찌개", ["또간집"]], ["미락식당", "경기 안산시", "돼지두루치기", ["또간집"]], ["정각", "서울 마포구 망원동", "돈치살, 소갈비된장찌개", ["또간집"]], ["진수식당", "광주 서구", "백반", ["또간집"]], ["동송칡냉면", "강원 철원군", "얼큰수제비 만두전골", ["또간집"]], ["원조이모네연탄불곱창", "서울 노원구", "소금구이", ["또간집"]], ["예돈돈까스", "경기 성남시 분당구", "돈까스", ["또간집"]], ["부엌", "경남 김해시", "스파이시 크림파스타, 우대갈비스튜, 감바스", ["또간집"]], ["갓포이찌", "울산 남구", "모둠사시미, 스지오뎅나베", ["또간집"]], ["천성삼거리장어구이", "부산 강서구 천성동", "장어탕, 장어구이", ["또간집"]], ["북경탕수육", "충남 공주시", "김치치즈탕수육", ["또간집"]], ["다락가든", "충남 논산시", "청국장정식", ["또간집"]], ["경림수산", "경기 이천시", "조개구이, 가리비회", ["또간집"]], ["박가네", "강원 영월군", "단종의 밥상", ["또간집"]], ["주문진 막국수", "부산 동래구 사직동", "물막국수, 수육", ["또간집"]], ["밀향기", "경기 구리시", "김치만둣국", ["또간집"]], ["아들딸사랑한다", "전북 정읍시", "김치매운갈비찜", ["또간집"]], ["용수촌", "전북 익산시", "오징어볶음", ["또간집"]], ["키친후가", "전북 군산시", "새우폭탄버거, 감자튀김", ["또간집"]]];
// CURATED_DB_END

export async function onRequestPost(context) {
  const { request, env } = context;
  const kakaoKey = env && env.KAKAO_REST_API_KEY ? String(env.KAKAO_REST_API_KEY).trim() : '';
  const googleKey = env && env.GOOGLE_PLACES_API_KEY ? String(env.GOOGLE_PLACES_API_KEY).trim() : '';
  const tmapKey = env && env.TMAP_APP_KEY ? String(env.TMAP_APP_KEY).trim() : '';

  if (!kakaoKey) {
    return jsonResponse({ error: 'KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.' }, 500);
  }

  const apiCalls = {
    kakaoLocal: 0,
    kakaoDirections: 0,
    tmapWalk: 0,
    googleEnterprise: 0
  };
  const debug = {
    kakaoError: null,
    googleError: null
  };

  try {
    const body = await request.json();
    const originQuery = (body && body.origin ? body.origin : '').trim();
    const destQuery = (body && body.destination ? body.destination : '').trim();
    const keyword = (body && body.keyword ? body.keyword : '').trim();
    const mode = (body && body.mode === 'walk') ? 'walk' : 'car';
    const enrichRatings = (body ? body.enrichRatings !== false : true) && Boolean(googleKey);

    if (!originQuery || !destQuery) {
      return jsonResponse({ error: '출발지와 목적지를 모두 입력해 주세요.' }, 400);
    }

    if (mode === 'walk' && !tmapKey) {
      return jsonResponse({ error: '도보 경로를 사용하려면 Cloudflare 환경변수에 TMAP_APP_KEY를 등록해 주세요.' }, 400);
    }

    // 1. Geocode Origin & Destination (2 calls)
    const [origin, destination] = await Promise.all([
      geocodeKakao(originQuery, kakaoKey, apiCalls),
      geocodeKakao(destQuery, kakaoKey, apiCalls)
    ]);

    if (!origin) return jsonResponse({ error: '출발지를 찾을 수 없습니다: ' + originQuery }, 404);
    if (!destination) return jsonResponse({ error: '목적지를 찾을 수 없습니다: ' + destQuery }, 404);

    // 2. Route Polyline (1 call)
    let totalDistanceM = 0;
    let totalDurationSec = 0;
    let polyline = [];
    let roadPoints = [];

    if (mode === 'walk') {
      apiCalls.tmapWalk += 1;
      const tmapResp = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'appKey': tmapKey
        },
        body: JSON.stringify({
          startX: origin.lng,
          startY: origin.lat,
          endX: destination.lng,
          endY: destination.lat,
          startName: encodeURIComponent(origin.name || '출발'),
          endName: encodeURIComponent(destination.name || '도착'),
          reqCoordType: 'WGS84GEO',
          resCoordType: 'WGS84GEO'
        })
      });

      if (!tmapResp.ok) {
        const txt = await tmapResp.text();
        return jsonResponse({ error: 'TMAP 도보 경로 호출 실패 (' + String(tmapResp.status) + ')', detail: txt }, 502);
      }
      const tmapData = await tmapResp.json();
      const parsed = extractTmapWalkPoints(tmapData);
      if (parsed.polyline.length === 0) {
        return jsonResponse({ error: 'TMAP 도보 경로를 찾을 수 없습니다.' }, 422);
      }
      totalDistanceM = parsed.totalDistanceM;
      totalDurationSec = parsed.totalDurationSec;
      polyline = parsed.polyline;
      roadPoints = parsed.roadPoints;
    } else {
      const dirParams = new URLSearchParams({
        origin: String(origin.lng) + ',' + String(origin.lat),
        destination: String(destination.lng) + ',' + String(destination.lat),
        priority: 'RECOMMEND'
      });
      apiCalls.kakaoDirections += 1;
      const dirResp = await fetch('https://apis-navi.kakaomobility.com/v1/directions?' + dirParams.toString(), {
        headers: { Authorization: 'KakaoAK ' + kakaoKey }
      });
      if (!dirResp.ok) {
        const txt = await dirResp.text();
        return jsonResponse({ error: '카카오 길찾기 호출 실패 (' + String(dirResp.status) + ')', detail: txt }, 502);
      }
      const dirData = await dirResp.json();
      const mainRoute = dirData && dirData.routes ? dirData.routes[0] : null;
      if (!mainRoute || mainRoute.result_code !== 0) {
        return jsonResponse({ error: (mainRoute && mainRoute.result_msg) || '자동차 경로를 계산할 수 없습니다.' }, 422);
      }
      totalDistanceM = (mainRoute.summary && mainRoute.summary.distance) || 0;
      totalDurationSec = (mainRoute.summary && mainRoute.summary.duration) || 0;
      const parsed = extractKakaoCarPoints(mainRoute);
      polyline = parsed.polyline;
      roadPoints = parsed.roadPoints;
    }

    // 3. Sampling Nodes (6 nodes)
    const samplingNodes = buildSamplingNodes(roadPoints, 6, mode);

    // 4. Kakao Local Discovery (12 calls for general, 6 for keyword)
    const placeMap = new Map();
    const failedNodeIdx = new Set();
    const kakaoTasks = [];

    samplingNodes.forEach((node, idx) => {
      if (keyword) {
        kakaoTasks.push(
          fetchKakaoKeywordOnce(node, keyword, kakaoKey, apiCalls, mode)
            .then((docs) => {
              docs.forEach((doc) => {
                const cat = doc.category_group_code === 'CE7' ? 'cafe' : 'food';
                mergeKakaoDoc(placeMap, doc, cat, null);
              });
            })
            .catch((e) => {
              failedNodeIdx.add(idx);
              if (!debug.kakaoError) debug.kakaoError = e.message;
            })
        );
      } else {
        const codes = [
          { code: 'FD6', cat: 'food' },
          { code: 'CE7', cat: 'cafe' }
        ];
        for (const item of codes) {
          kakaoTasks.push(
            fetchKakaoCategoryOnce(node, item.code, kakaoKey, apiCalls)
              .then((docs) => docs.forEach((doc) => mergeKakaoDoc(placeMap, doc, item.cat, null)))
              .catch((e) => {
                failedNodeIdx.add(idx);
                if (!debug.kakaoError) debug.kakaoError = e.message;
              })
          );
        }
      }
    });

    await Promise.all(kakaoTasks);

    // 4.5 Active Curated Discovery: find 먹을텐데·최자로드 places in districts along this route (max 10 calls)
    const routeDistricts = collectRouteDistricts(origin, destination, placeMap);
    const curatedPool = CURATED_DB.filter((entry) => {
      const area = entry[1] || '';
      const name = entry[0] || '';
      const menu = entry[2] || '';
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!name.toLowerCase().includes(kw) && !menu.toLowerCase().includes(kw)) return false;
      }
      const tokens = area.split(' ');
      const si = tokens[0] || '';
      const gu = tokens[1] || '';
      if (!gu) return routeDistricts.has(si);
      return routeDistricts.has(gu) || routeDistricts.has(si + ' ' + gu);
    });
    const curatedCandidates = pickBalancedCurated(curatedPool, 10);

    if (curatedCandidates.length > 0) {
      await Promise.all(
        curatedCandidates.map(async (entry) => {
          const cName = entry[0];
          const cArea = entry[1];
          const cMenu = entry[2];
          const cSources = entry[3];
          try {
            apiCalls.kakaoLocal += 1;
            const q = cName + ' ' + (cArea.split(' ').slice(0, 2).join(' '));
            const url = 'https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(q) + '&size=1';
            const resp = await fetch(url, { headers: { Authorization: 'KakaoAK ' + kakaoKey } });
            if (!resp.ok) return;
            const data = await resp.json();
            const doc = data && data.documents ? data.documents[0] : null;
            if (doc) {
              const cat = doc.category_group_code === 'CE7' ? 'cafe' : 'food';
              mergeKakaoDoc(placeMap, doc, cat, { sources: cSources, menu: cMenu });
            }
          } catch {}
        })
      );
    }

    // 5. Corridor Geometry & Detour Estimation
    const maxCorridorKm = mode === 'walk' ? 1.2 : 5.5;
    const allCandidates = Array.from(placeMap.values()).map((p) => {
      const nearest = findNearestRoadPoint(p.lat, p.lng, roadPoints);
      const directKm = Number(nearest.distKm.toFixed(2));
      const progressMin = Math.round((nearest.progressRatio * totalDurationSec) / 60);
      const icTrap = mode === 'car' && nearest.isHighway && directKm > 1.2;

      let estimatedDetourMin = 2;
      if (mode === 'walk') {
        estimatedDetourMin = Math.max(1, Math.round(directKm * 28));
      } else {
        estimatedDetourMin = Math.max(2, Math.round(directKm * 3.5 + (icTrap ? 11 : 1.5)));
      }

      return {
        ...p,
        directKm,
        progressMin,
        icTrap,
        icTrapReason: icTrap ? '고속도로·전용도로(' + (nearest.roadName || '고속구간') + ') 인접 구간으로 IC 우회 필요' : '',
        detourMin: estimatedDetourMin,
        detourVerified: false
      };
    });

    allCandidates.sort((a, b) => a.detourMin - b.detourMin);
    const corridorPlaces = allCandidates.filter((p) => p.directKm <= maxCorridorKm);

    // 6. Stage 2 Google Places Enrichment (prioritize curated places first, then balanced food & cafe)
    const usedSubrequests = apiCalls.kakaoLocal + apiCalls.kakaoDirections + apiCalls.tmapWalk;
    const googleBudget = Math.max(0, Math.min(22, 45 - usedSubrequests));

    if (enrichRatings && googleBudget > 0 && corridorPlaces.length > 0) {
      const targets = pickPriorityTargets(corridorPlaces, googleBudget);
      await runBatched(targets, 5, async (place) => {
        const res = await enrichWithGooglePlaces(place, googleKey, apiCalls);
        if (res.error && !debug.googleError) {
          debug.googleError = res.error;
        }
        const g = res.place;
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

    const foodCount = corridorPlaces.filter((p) => p.category === 'food').length;
    const cafeCount = corridorPlaces.filter((p) => p.category === 'cafe').length;
    const matchedCount = corridorPlaces.filter((p) => p.rating !== null).length;
    const curatedCount = corridorPlaces.filter((p) => p.curatedSources && p.curatedSources.length > 0).length;

    return jsonResponse({
      route: {
        mode,
        origin,
        destination,
        distanceKm: Number((totalDistanceM / 1000).toFixed(2)),
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
        foodCount,
        cafeCount,
        curatedCount,
        ratingMatched: matchedCount,
        unrated: corridorPlaces.length - matchedCount,
        googleEnabled: Boolean(googleKey)
      },
      places: corridorPlaces,
      apiCalls,
      debug
    });
  } catch (err) {
    return jsonResponse({ error: (err && err.message) || '경로 탐색 처리 중 오류가 발생했습니다.' }, 500);
  }
}

function collectRouteDistricts(origin, destination, placeMap) {
  const set = new Set();
  const addAddr = (addr) => {
    const parts = String(addr || '').trim().split(/\s+/);
    if (parts[0]) set.add(parts[0].replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, ''));
    if (parts[1]) {
      set.add(parts[1]);
      if (parts[0]) set.add(parts[0].replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '') + ' ' + parts[1]);
    }
  };
  addAddr(origin && origin.address);
  addAddr(destination && destination.address);
  for (const p of placeMap.values()) {
    addAddr(p.address || p.zone);
  }
  return set;
}

function pickPriorityTargets(places, budget) {
  const picked = [];
  const used = new Set();
  // 1) Curated places first
  for (const p of places) {
    if (picked.length >= budget) break;
    if (p.curatedSources && p.curatedSources.length > 0 && !used.has(p.id)) {
      used.add(p.id);
      picked.push(p);
    }
  }
  // 2) Balanced food & cafe
  const foods = places.filter((p) => p.category === 'food' && !used.has(p.id));
  const cafes = places.filter((p) => p.category === 'cafe' && !used.has(p.id));
  let idx = 0;
  while (picked.length < budget) {
    let added = false;
    for (const list of [foods, cafes]) {
      if (picked.length >= budget) break;
      const item = list[idx];
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

function extractTmapWalkPoints(tmapData) {
  const features = (tmapData && Array.isArray(tmapData.features)) ? tmapData.features : [];
  let totalDistanceM = 0;
  let totalDurationSec = 0;
  const polyline = [];
  const roadPoints = [];
  let cumulativeM = 0;

  for (const feat of features) {
    const props = feat.properties || {};
    if (props.totalDistance && !totalDistanceM) totalDistanceM = Number(props.totalDistance) || 0;
    if (props.totalTime && !totalDurationSec) totalDurationSec = Number(props.totalTime) || 0;

    const geom = feat.geometry || {};
    const roadName = props.name || '';
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      for (const coord of geom.coordinates) {
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (polyline.length > 0) {
          const prev = polyline[polyline.length - 1];
          cumulativeM += haversineKm(prev[0], prev[1], lat, lng) * 1000;
        }
        polyline.push([lat, lng]);
        roadPoints.push({ lat, lng, roadName, isHighway: false, cumulativeM });
      }
    }
  }

  const totalM = Math.max(1, cumulativeM);
  for (const pt of roadPoints) {
    pt.progressRatio = pt.cumulativeM / totalM;
  }
  const step = Math.max(1, Math.floor(polyline.length / 200));
  const slimPolyline = polyline.filter((_, idx) => idx % step === 0 || idx === polyline.length - 1);
  return {
    totalDistanceM: totalDistanceM || Math.round(cumulativeM),
    totalDurationSec: totalDurationSec || Math.round((cumulativeM / 1000) * 900),
    polyline: slimPolyline,
    roadPoints
  };
}

function extractKakaoCarPoints(route) {
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

function buildSamplingNodes(roadPoints, maxNodes, mode) {
  const count = maxNodes || 6;
  if (roadPoints.length === 0) return [];
  const nodes = [];
  for (let k = 0; k < count; k++) {
    const targetRatio = k / Math.max(1, count - 1);
    let bestPt = roadPoints[0];
    let bestDiff = 999;
    for (let i = 0; i < roadPoints.length; i++) {
      const diff = Math.abs(roadPoints[i].progressRatio - targetRatio);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPt = roadPoints[i];
      }
    }
    const fallbackName = k === 0 ? '출발권' : (k === count - 1 ? '목적지권' : '경로 ' + String(k + 1) + '구간');
    const radius = mode === 'walk' ? 450 : (bestPt.isHighway ? 4000 : 3000);
    nodes.push({
      name: bestPt.roadName || fallbackName,
      lat: bestPt.lat,
      lng: bestPt.lng,
      radius,
      type: mode === 'walk' ? 'walk' : (bestPt.isHighway ? 'ic' : 'urban')
    });
  }
  return nodes;
}

async function geocodeKakao(query, kakaoKey, apiCalls) {
  apiCalls.kakaoLocal += 1;
  const kwUrl = 'https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(query) + '&size=1';
  const kwResp = await fetch(kwUrl, { headers: { Authorization: 'KakaoAK ' + kakaoKey } });
  if (kwResp.ok) {
    const kwData = await kwResp.json();
    const doc = kwData && kwData.documents ? kwData.documents[0] : null;
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
  const addrUrl = 'https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(query) + '&size=1';
  const addrResp = await fetch(addrUrl, { headers: { Authorization: 'KakaoAK ' + kakaoKey } });
  if (addrResp.ok) {
    const addrData = await addrResp.json();
    const doc = addrData && addrData.documents ? addrData.documents[0] : null;
    if (doc) {
      return {
        name: query,
        address: (doc.road_address && doc.road_address.address_name) || (doc.address && doc.address.address_name) || query,
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x)
      };
    }
  }
  return null;
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
  const resp = await fetch('https://dapi.kakao.com/v2/local/search/category.json?' + params.toString(), {
    headers: { Authorization: 'KakaoAK ' + kakaoKey }
  });
  if (!resp.ok) throw new Error('Kakao ' + String(resp.status));
  const data = await resp.json();
  return data.documents || [];
}

async function fetchKakaoKeywordOnce(node, keyword, kakaoKey, apiCalls, mode) {
  apiCalls.kakaoLocal += 1;
  const searchRadius = mode === 'walk' ? 650 : Math.min(5000, node.radius + 1000);
  const params = new URLSearchParams({
    query: keyword,
    x: String(node.lng),
    y: String(node.lat),
    radius: String(searchRadius),
    size: '15',
    page: '1',
    sort: 'distance'
  });
  const resp = await fetch('https://dapi.kakao.com/v2/local/search/keyword.json?' + params.toString(), {
    headers: { Authorization: 'KakaoAK ' + kakaoKey }
  });
  if (!resp.ok) throw new Error('Kakao ' + String(resp.status));
  const data = await resp.json();
  return data.documents || [];
}

function mergeKakaoDoc(placeMap, doc, category, curatedInfo) {
  if (!doc || !doc.id) return;
  if (placeMap.has(doc.id)) {
    if (curatedInfo) {
      const existing = placeMap.get(doc.id);
      existing.curatedSources = curatedInfo.sources || existing.curatedSources || [];
      if (curatedInfo.menu && !existing.tags.includes(curatedInfo.menu)) {
        existing.tags.unshift(curatedInfo.menu);
      }
    }
    return;
  }
  const catParts = (doc.category_name || '').split('>').map((s) => s.trim()).filter(Boolean);
  const tags = catParts.slice(1, 4);
  if (curatedInfo && curatedInfo.menu && !tags.includes(curatedInfo.menu)) {
    tags.unshift(curatedInfo.menu);
  }
  const addr = doc.road_address_name || doc.address_name || '';
  const zone = addr.split(' ').slice(0, 3).join(' ');

  placeMap.set(doc.id, {
    id: doc.id,
    name: doc.place_name,
    category: category === 'cafe' ? 'cafe' : 'food',
    zone: zone || '경로 주변',
    address: addr,
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    phone: doc.phone || '',
    kakaoUrl: doc.place_url || '',
    rating: null,
    reviews: 0,
    tags: tags.length > 0 ? tags : [category === 'cafe' ? '카페' : '음식점'],
    source: '카카오 로컬 (Google 미확인)',
    hoursText: '영업시간 미확인(상세 링크 확인)',
    googlePeriods: null,
    curatedSources: curatedInfo ? (curatedInfo.sources || []) : []
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
        textQuery: place.name + ' ' + place.zone,
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
    if (!resp.ok) {
      return { place: null, error: 'Google HTTP ' + String(resp.status) };
    }
    const data = await resp.json();
    return { place: (data && data.places ? data.places[0] : null), error: null };
  } catch (e) {
    return { place: null, error: (e && e.message) || 'Google fetch error' };
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

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}


function pickBalancedCurated(pool, limit) {
  const buckets = { '먹을텐데': [], '최자로드': [], '또간집': [] };
  const others = [];
  pool.forEach((entry) => {
    const srcs = entry[3] || [];
    if (srcs.includes('또간집')) buckets['또간집'].push(entry);
    else if (srcs.includes('최자로드')) buckets['최자로드'].push(entry);
    else if (srcs.includes('먹을텐데')) buckets['먹을텐데'].push(entry);
    else others.push(entry);
  });
  const picked = [];
  const keys = ['먹을텐데', '최자로드', '또간집'];
  let idx = 0;
  while (picked.length < limit) {
    let addedAny = false;
    for (let k = 0; k < keys.length && picked.length < limit; k++) {
      const arr = buckets[keys[k]];
      if (idx < arr.length) {
        picked.push(arr[idx]);
        addedAny = true;
      }
    }
    if (!addedAny) break;
    idx += 1;
  }
  for (let i = 0; i < others.length && picked.length < limit; i++) {
    picked.push(others[i]);
  }
  return picked;
}
