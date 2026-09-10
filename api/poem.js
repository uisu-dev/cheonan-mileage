const { getSupabase, cors } = require('../lib/supabase');

// ~600명 동시: 저비용 모델 + 짧은 컨텍스트 + 학생당 쿨다운
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_HISTORY = 12;          // 최근 12메시지 (user+assistant)
const MAX_USER_CHARS = 800;
const MAX_TOKENS = 280;
const MIN_CHAT_INTERVAL_MS = 8000; // 학생당 최소 8초 (생각 시간)
const MAX_CHAT_LOG_SUBMIT = 24;

const SYSTEM_PROMPT = `너는 천안중학교 학생의 '인권 관련 생활시' 작성을 돕는 촉진자 챗봇이다.

인권을 넓게 본다:
- 차별·불공평뿐 아니라, 공동체의 생활, 서로 존중하기, 배려, 경청, 약속 지키기, 함께 살아가기, 표현과 참여, 안전하고 존중받는 관계 등도 인권의 이야기이다.
- 학교 불만·험담·특정 사람 비난으로 대화를 몰지 않는다. 불만이 나와도 존중·공존·배려의 방향으로 부드럽게 돌린다.

역할:
- 짧은 질문 1~2개로 경험·감정·생각(존중·공동체·배려 등)을 이끈다.
- 한국어, 중학생에게 쉬운 말투. 답은 4문장 이내.
- 첫 대화에서는 넓은 인권 개념을 짧게 안내한 뒤 열린 질문을 한다.

절대 금지:
- 시 대필·초안·시 형태 예시 전문 제공 금지.
- "대신 써줘" 요청은 거절하고 질문만 한다.
- 폭력·자해·성적 조장 금지. 위험 시 선생님·보호자 안내.
- "불공평했니?", "무시당했니?"처럼 불만·피해만 유도하는 질문으로 시작하지 않는다.`;

const WRITE_REQUEST_RE = /(대신\s*써|시를?\s*써\s*줘|초안|완성해\s*줘|작성해\s*줘|만들어\s*줘|대필|써\s*줘\s*봐)/i;

function normalizeMessages(raw, limit) {
  if (!Array.isArray(raw)) return [];
  const lim = limit || MAX_HISTORY;
  return raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: String(m.content).slice(0, MAX_USER_CHARS) }))
    .slice(-lim);
}

async function throttleChat(supabase, studentId) {
  const now = Date.now();
  const { data } = await supabase
    .from('poem_chat_throttle')
    .select('last_chat_at')
    .eq('student_id', studentId)
    .maybeSingle();

  if (data && data.last_chat_at) {
    const last = new Date(data.last_chat_at).getTime();
    const wait = MIN_CHAT_INTERVAL_MS - (now - last);
    if (wait > 0) {
      return { ok: false, waitMs: wait, msg: '질문이 너무 빨라요. ' + Math.ceil(wait / 1000) + '초만 기다렸다가 다시 보내 주세요. (친구들도 함께 쓰고 있어요)' };
    }
  }

  const row = { student_id: studentId, last_chat_at: new Date(now).toISOString() };
  const { error } = await supabase.from('poem_chat_throttle').upsert(row, { onConflict: 'student_id' });
  // 테이블 없으면 스로틀 스킵 (배포 전 SQL 미실행)
  if (error && /does not exist|schema cache/i.test(String(error.message || ''))) {
    return { ok: true, soft: true };
  }
  if (error) console.error('throttle upsert', error.message);
  return { ok: true };
}

async function callOpenAI(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, msg: '서버에 OPENAI_API_KEY가 설정되지 않았습니다. 관리자에게 문의하세요.' };
  }
  const body = {
    model: MODEL,
    temperature: 0.6,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]
  };

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return { ok: false, msg: '챗봇 연결 실패. 잠시 후 다시 시도해 주세요.' };
  }

  const data = await resp.json().catch(() => ({}));
  if (resp.status === 429) {
    return { ok: false, msg: '지금 접속이 몰려 있어요. 10~20초 뒤에 다시 말해 주세요.' };
  }
  if (!resp.ok) {
    const err = (data && data.error && data.error.message) || ('OpenAI HTTP ' + resp.status);
    return { ok: false, msg: '챗봇 오류: ' + err };
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) return { ok: false, msg: '챗봇 응답이 비어 있습니다.' };
  return { ok: true, reply: String(text).trim() };
}

async function assertStudent(supabase, studentId) {
  const id = String(studentId || '').trim();
  if (!id) return { ok: false, msg: '학번이 필요합니다.' };
  const { data, error } = await supabase.from('users').select('id, name, role').eq('id', id).maybeSingle();
  if (error) return { ok: false, msg: error.message };
  if (!data) return { ok: false, msg: '등록되지 않은 학번입니다.' };
  if (data.role && data.role !== 'student') return { ok: false, msg: '학생 계정만 이용할 수 있습니다.' };
  return { ok: true, user: data };
}

async function assertTeacher(supabase, teacherId) {
  const id = String(teacherId || '').trim();
  if (!id) return { ok: false, msg: '교사 정보가 필요합니다.' };
  const { data, error } = await supabase.from('users').select('id, name, role').eq('id', id).maybeSingle();
  if (error) return { ok: false, msg: error.message };
  if (!data) return { ok: false, msg: '교사를 찾을 수 없습니다.' };
  if (data.role !== 'teacher' && data.role !== 'admin') {
    return { ok: false, msg: '교사만 목록을 볼 수 있습니다.' };
  }
  return { ok: true, user: data };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body || {};
  const supabase = getSupabase();

  if (action === 'chat') {
    const { studentId, messages, message } = req.body;
    const st = await assertStudent(supabase, studentId);
    if (!st.ok) return res.json({ success: false, msg: st.msg });

    const throttled = await throttleChat(supabase, String(studentId).trim());
    if (!throttled.ok) return res.json({ success: false, msg: throttled.msg, waitMs: throttled.waitMs });

    let history = normalizeMessages(messages, MAX_HISTORY);
    const userMsg = String(message || '').trim();
    if (!userMsg) return res.json({ success: false, msg: '메시지를 입력하세요.' });
    if (userMsg.length > MAX_USER_CHARS) {
      return res.json({ success: false, msg: '메시지는 ' + MAX_USER_CHARS + '자까지예요.' });
    }

    history = history.concat([{ role: 'user', content: userMsg }]).slice(-MAX_HISTORY);

    if (WRITE_REQUEST_RE.test(userMsg)) {
      const refuse =
        '나는 시를 대신 써 줄 수 없어. 네가 직접 쓰는 게 중요하거든. ' +
        '방금 떠오른 장면 중에서, 가장 기억에 남는 한 순간을 한 문장으로만 말해 줄래?';
      return res.json({
        success: true,
        reply: refuse,
        messages: history.concat([{ role: 'assistant', content: refuse }]).slice(-MAX_HISTORY)
      });
    }

    const ai = await callOpenAI(history);
    if (!ai.ok) return res.json({ success: false, msg: ai.msg });

    const next = history.concat([{ role: 'assistant', content: ai.reply }]).slice(-MAX_HISTORY);
    return res.json({ success: true, reply: ai.reply, messages: next, model: MODEL });
  }

  if (action === 'submit') {
    const { studentId, studentName, poem, chatLog } = req.body;
    const st = await assertStudent(supabase, studentId);
    if (!st.ok) return res.json({ success: false, msg: st.msg });

    const poemText = String(poem || '').trim();
    const poemLines = poemText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (poemLines.length < 10) {
      return res.json({ success: false, msg: '시는 빈 줄 제외하고 최소 10줄 이상 작성해 주세요. (현재 ' + poemLines.length + '줄)' });
    }
    if (poemText.length > 8000) {
      return res.json({ success: false, msg: '시가 너무 깁니다.' });
    }

    const log = normalizeMessages(chatLog, MAX_CHAT_LOG_SUBMIT);
    const userTurns = log.filter(m => m.role === 'user').length;
    if (userTurns < 2) {
      return res.json({ success: false, msg: '챗봇과 충분히 대화한 뒤 제출해 주세요. (학생 메시지 2회 이상)' });
    }

    const name = String(studentName || st.user.name || '').trim() || st.user.name;
    const row = {
      student_id: String(studentId).trim(),
      student_name: name,
      poem: poemText,
      chat_log: log,
      updated_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from('human_rights_poems')
      .select('id')
      .eq('student_id', row.student_id)
      .maybeSingle();

    let error;
    if (existing && existing.id) {
      ({ error } = await supabase.from('human_rights_poems').update(row).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('human_rights_poems').insert({
        ...row,
        created_at: new Date().toISOString()
      }));
    }

    if (error) {
      const msg = String(error.message || '');
      if (/human_rights_poems|schema cache|does not exist/i.test(msg)) {
        return res.json({
          success: false,
          msg: 'DB 테이블이 아직 없습니다. sql/human_rights_poems.sql 을 Supabase에서 실행해 주세요.'
        });
      }
      return res.json({ success: false, msg: '제출 실패: ' + msg });
    }
    return res.json({ success: true, msg: existing ? '제출이 수정되었습니다.' : '제출되었습니다.' });
  }

  if (action === 'mySubmission') {
    const { studentId } = req.body;
    const st = await assertStudent(supabase, studentId);
    if (!st.ok) return res.json({ success: false, msg: st.msg });
    const { data, error } = await supabase
      .from('human_rights_poems')
      .select('*')
      .eq('student_id', String(studentId).trim())
      .maybeSingle();
    if (error) {
      if (/does not exist|schema cache/i.test(String(error.message || ''))) {
        return res.json({ success: true, submission: null });
      }
      return res.json({ success: false, msg: error.message });
    }
    if (!data) return res.json({ success: true, submission: null });
    return res.json({
      success: true,
      submission: {
        poem: data.poem || '',
        chatLog: data.chat_log || [],
        updatedAt: data.updated_at || data.created_at || ''
      }
    });
  }

  if (action === 'list') {
    const { teacherId } = req.body;
    const t = await assertTeacher(supabase, teacherId);
    if (!t.ok) return res.json({ success: false, msg: t.msg });
    const { data, error } = await supabase
      .from('human_rights_poems')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) {
      if (/does not exist|schema cache/i.test(String(error.message || ''))) {
        return res.json({
          success: false,
          msg: 'DB 테이블이 아직 없습니다. sql/human_rights_poems.sql 을 실행해 주세요.'
        });
      }
      return res.json({ success: false, msg: error.message });
    }
    return res.json({
      success: true,
      submissions: (data || []).map(r => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        poem: r.poem,
        chatLog: r.chat_log || [],
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
