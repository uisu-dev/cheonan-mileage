const { getSupabase, cors } = require('../lib/supabase');

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

// ===== 상점 우수자(전교 상위 5명) 설문 =====
// 대상자: 2026-10-14 기준 상점(교사 지급 양수 포인트 합계) 전교 상위 5명으로 고정.
const MERIT_SURVEY_ID = 'merit_top5_2026';
const MERIT_SURVEY_TITLE = '상점 우수자 설문';
const MERIT_QUESTIONS = [
  '올해 초 나의 학교생활은 어땠나요? 잘하고 있었던 점과 더 노력하고 싶었던 점을 적어 주세요.',
  '어떤 행동으로 상점을 받았나요? 가장 기억에 남는 한 가지를 골라, 언제·어디서·무엇을 했는지 적어 주세요.',
  '그때 선생님은 어떤 말이나 행동을 해 주셨나요? 칭찬, 인정, 도움 등 기억나는 내용을 적어 주세요.',
  '그 경험을 했을 때 어떤 생각이나 기분이 들었나요?',
  '그 이후 학교생활에서 달라진 점이나 계속 실천하게 된 행동이 있나요? 변화가 없다면 그대로 적어 주세요.',
  '최근에 그 행동을 실제로 실천한 장면을 하나 알려 주세요. 언제, 어떤 상황에서, 어떻게 행동했나요?',
  '그 행동을 실천하는 데 무엇이 도움이 되었나요? 상점, 선생님의 말, 친구, 학교 활동, 자신의 노력 등 도움이 된 것과 이유를 적어 주세요.',
  '앞으로 계속하고 싶은 행동은 무엇인가요? 상점 운영이나 학교 활동에서 개선되었으면 하는 점도 적어 주세요.'
].map(q => ({ q, type: 'text', opts: [] }));

// 2026-10-14 기준 전교 상점 상위 5명으로 대상자 고정 (실시간 계산 X)
const MERIT_TOP5_IDS = ['10327', '10521', '10320', '20126', '10605'];

async function getMeritTop(supabase) {
  const { data } = await supabase.from('users').select('id,name').in('id', MERIT_TOP5_IDS);
  const names = new Map((data || []).map(u => [String(u.id), u.name]));
  return MERIT_TOP5_IDS.map(id => ({ id, name: names.get(id) || '' }));
}

// 설문 행이 없으면 생성 (status 'M' = 대상자 전용 → 일반 설문 목록(status 'O')에는 안 보임)
async function ensureMeritSurvey(supabase) {
  const { data } = await supabase.from('surveys').select('id,status').eq('id', MERIT_SURVEY_ID);
  if (data && data.length) return data[0];
  const row = { id: MERIT_SURVEY_ID, title: MERIT_SURVEY_TITLE, questions: MERIT_QUESTIONS, status: 'M', allow_photo: false, allow_video: false };
  await supabase.from('surveys').insert(row);
  return row;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { title, questions, allowPhoto, allowVideo } = req.body;
    const row = { id: String(Date.now()), title, questions, status: 'O', allow_photo: !!allowPhoto, allow_video: !!allowVideo };

    let { error } = await supabase.from('surveys').insert(row);
    // 컬럼이 없는 경우 단계적 fallback
    if (error && String(error.message || '').toLowerCase().includes('allow_video')) {
      delete row.allow_video;
      const r2 = await supabase.from('surveys').insert(row);
      error = r2.error;
    }
    if (error && String(error.message || '').toLowerCase().includes('allow_photo')) {
      delete row.allow_photo;
      const r3 = await supabase.from('surveys').insert(row);
      error = r3.error;
    }
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    return res.json({ success: true, msg: '등록' });
  }

  // 영상 직접 업로드용 정보 발급 (학생 클라이언트가 Storage에 PUT)
  if (action === 'getVideoUploadInfo') {
    const { studentId, surveyId, fileName, fileSize } = req.body;
    if (!studentId || !surveyId) return res.json({ success: false, msg: '정보 누락' });
    if (Number(fileSize) > MAX_VIDEO_BYTES) {
      return res.json({ success: false, msg: '영상은 최대 100MB까지 업로드 가능합니다.' });
    }
    const supaUrl = process.env.SUPABASE_URL || '';
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    if (!supaUrl || !anonKey) {
      return res.json({ success: false, msg: '서버 설정 오류 (SUPABASE_ANON_KEY 필요)' });
    }
    const ext = String(fileName || 'mp4').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
    const path = `videos/survey_${surveyId}_${studentId}_${Date.now()}.${ext}`;
    return res.json({
      success: true,
      uploadUrl: `${supaUrl}/storage/v1/object/survey-photos/${encodeURIComponent(path)}`,
      anonKey: anonKey,
      path: path
    });
  }

  if (action === 'vote') {
    const { studentId, surveyId, answers, fileData, videoPath } = req.body;

    // 중복 체크
    const { data: existing } = await supabase
      .from('survey_logs').select('id')
      .eq('vote_id', surveyId)
      .eq('student_id', studentId);

    if (existing && existing.length > 0) {
      return res.json({ success: false, msg: '이미 참여함' });
    }

    // 사진 업로드 (작은 이미지는 서버 경유로 그대로 진행)
    let photoUrl = '';
    if (fileData && fileData.data) {
      try {
        const buffer = Buffer.from(fileData.data, 'base64');
        const ext = (fileData.mimeType && fileData.mimeType.includes('png')) ? 'png' : 'jpg';
        const fileName = `survey_${surveyId}_${studentId}_${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('survey-photos').upload(fileName, buffer, {
            contentType: fileData.mimeType || 'image/jpeg', upsert: false
          });
        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('survey-photos').getPublicUrl(fileName);
          photoUrl = urlData.publicUrl;
        }
      } catch (e) {
        console.error('photo upload error:', e);
      }
    }

    // 영상은 클라이언트가 이미 직접 업로드함 → 경로만 받아서 publicUrl 생성
    let videoUrl = '';
    if (videoPath) {
      const { data: urlData } = supabase.storage.from('survey-photos').getPublicUrl(videoPath);
      videoUrl = urlData.publicUrl;
    }

    const logRow = { vote_id: surveyId, student_id: studentId, answer: answers, photo_url: photoUrl, video_url: videoUrl };
    let { error: logErr } = await supabase.from('survey_logs').insert(logRow);
    // 컬럼 단계적 fallback
    if (logErr && String(logErr.message || '').toLowerCase().includes('video_url')) {
      delete logRow.video_url;
      const r2 = await supabase.from('survey_logs').insert(logRow);
      logErr = r2.error;
    }
    if (logErr && String(logErr.message || '').toLowerCase().includes('photo_url')) {
      delete logRow.photo_url;
      await supabase.from('survey_logs').insert(logRow);
    }

    // +100P (단, 징계 중인 학생은 점수 미반영)
    const { data: user } = await supabase.from('users').select('points, penalty_total').eq('id', studentId).single();
    if (user) {
      const onPenalty = Number(user.penalty_total) > 0;
      if (onPenalty) {
        await supabase.from('logs').insert({ teacher: 'System', student_id: studentId, item: '설문 참여 (징계 중 점수 미반영)', point: 0 });
        return res.json({ success: true, msg: '참여 완료 (징계 중이므로 점수는 지급되지 않습니다)' });
      }
      await supabase.from('users').update({ points: Number(user.points) + 100 }).eq('id', studentId);
      await supabase.from('logs').insert({ teacher: 'System', student_id: studentId, item: '설문 참여', point: 100 });
    }
    return res.json({ success: true, msg: '완료' });
  }

  // 학생: 상점 우수자 설문 대상 여부 / 참여 여부
  if (action === 'meritStatus') {
    const sid = String(req.body.studentId || '').trim();
    if (!sid) return res.json({ success: false, eligible: false });
    try {
      const top = await getMeritTop(supabase);
      if (!top.some(t => t.id === sid)) return res.json({ success: true, eligible: false });
      const sv = await ensureMeritSurvey(supabase);
      const { data: ex } = await supabase.from('survey_logs').select('id').eq('vote_id', MERIT_SURVEY_ID).eq('student_id', sid);
      return res.json({ success: true, eligible: true, open: sv.status === 'M', done: !!(ex && ex.length),
        surveyId: MERIT_SURVEY_ID, title: MERIT_SURVEY_TITLE, questions: MERIT_QUESTIONS.map(x => x.q) });
    } catch (e) {
      return res.json({ success: false, eligible: false, msg: String(e.message || e) });
    }
  }

  // 교사: 현재 대상자 목록
  if (action === 'meritTop') {
    try { return res.json({ success: true, list: await getMeritTop(supabase) }); }
    catch (e) { return res.json({ success: false, msg: String(e.message || e) }); }
  }

  // 학생: 상점 우수자 설문 제출 (서버에서 자격 재확인, 1인 1회 - 재제출 불가)
  if (action === 'meritVote') {
    const sid = String(req.body.studentId || '').trim();
    const answers = req.body.answers;
    if (!sid || !Array.isArray(answers) || answers.length !== MERIT_QUESTIONS.length) return res.json({ success: false, msg: '정보 누락' });
    const clean = answers.map(a => String(a || '').trim().slice(0, 2000));
    if (clean.some(a => !a)) return res.json({ success: false, msg: '모든 문항에 답해 주세요.' });
    const top = await getMeritTop(supabase);
    if (!top.some(t => t.id === sid)) return res.json({ success: false, msg: '상점 우수자 설문 대상이 아닙니다.' });
    const sv = await ensureMeritSurvey(supabase);
    if (sv.status !== 'M') return res.json({ success: false, msg: '마감된 설문입니다.' });
    const { data: ex } = await supabase.from('survey_logs').select('id').eq('vote_id', MERIT_SURVEY_ID).eq('student_id', sid);
    if (ex && ex.length) return res.json({ success: false, msg: '이미 참여함' });
    const { error } = await supabase.from('survey_logs').insert({ vote_id: MERIT_SURVEY_ID, student_id: sid, answer: clean });
    if (error) return res.json({ success: false, msg: '제출 실패: ' + error.message });
    return res.json({ success: true, msg: '제출 완료! 소중한 답변 고마워요.' });
  }

  if (action === 'delete') {
    const { id } = req.body;
    await supabase.from('surveys').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  if (action === 'close') {
    const { id } = req.body;
    await supabase.from('surveys').update({ status: 'C' }).eq('id', id);
    if (id === MERIT_SURVEY_ID) return res.json({ success: true, msg: '마감되었습니다.' });
    return res.json({ success: true, msg: '마감되었습니다. 학생 화면에서 숨겨집니다.' });
  }

  if (action === 'reopen') {
    const { id } = req.body;
    // 상점 우수자 설문은 'O'(전체 공개)가 아니라 'M'(대상자 전용)으로 되돌림
    await supabase.from('surveys').update({ status: id === MERIT_SURVEY_ID ? 'M' : 'O' }).eq('id', id);
    return res.json({ success: true, msg: '다시 공개되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
