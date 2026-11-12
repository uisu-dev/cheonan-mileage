const { getSupabase, cors } = require('../lib/supabase');
const C = require('../lib/counseling');

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB (base64 인코딩 후 Vercel 4.5MB 한도 내 안전)

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  // 읽기·공유·삭제는 작성자/공유 권한을 서버에서 확인 (lib/counseling.js)
  if (action !== 'create') {
    try {
      const out = await C.handle(req.body || {}, { supabase });
      if (out) return res.json(out);
    } catch (e) { return res.json({ success: false, msg: '서버 오류: ' + (e && e.message ? e.message : e) }); }
    return res.json({ success: false, msg: '알 수 없는 action' });
  }

  if (action === 'create') {
    const { studentId, participantIds, counselDate, counselType, content, fileData } = req.body;
    const author = await C.getTeacher(supabase, req.body.teacherId);
    if (!author) return res.json({ success: false, msg: '교사만 상담 기록을 작성할 수 있습니다.' });
    if (!studentId || !counselDate || !content) {
      return res.json({ success: false, msg: '상담일시·내용은 필수입니다.' });
    }

    // 공동 참여자 처리: studentId + participantIds(중복 제거)
    const allIds = [String(studentId).trim()];
    if (Array.isArray(participantIds)) {
      participantIds.forEach(p => {
        const pid = String(p).trim();
        if (pid && !allIds.includes(pid)) allIds.push(pid);
      });
    }

    // 세션 ID 생성 (공동 상담일 때만)
    let sessionId = '';
    let participantsStr = '';
    if (allIds.length > 1) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      const { data: users } = await supabase.from('users').select('id, name').in('id', allIds);
      const nameMap = {};
      (users || []).forEach(u => { nameMap[String(u.id).trim()] = u.name; });
      participantsStr = allIds.map(id => (nameMap[id] || '미등록') + '(' + id + ')').join(', ');
    }

    // 파일 업로드 (선택, 한 번만 업로드)
    let fileUrl = '';
    if (fileData && fileData.data) {
      try {
        const buffer = Buffer.from(fileData.data, 'base64');
        if (buffer.length > MAX_FILE_BYTES) {
          return res.json({ success: false, msg: '첨부파일은 최대 3MB까지 업로드 가능합니다.' });
        }
        const rawName = fileData.fileName || 'file';
        const ext = String(rawName).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
        const savedFileName = `counsel_${studentId}_${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage
          .from('counseling-files').upload(savedFileName, buffer, {
            contentType: fileData.mimeType || 'application/octet-stream', upsert: false
          });
        if (!upErr && up) {
          const { data: urlData } = supabase.storage.from('counseling-files').getPublicUrl(savedFileName);
          fileUrl = urlData.publicUrl;
        } else if (upErr) {
          return res.json({ success: false, msg: '파일 업로드 실패: ' + upErr.message });
        }
      } catch (e) {
        return res.json({ success: false, msg: '파일 처리 오류: ' + e.message });
      }
    }

    // 각 참여 학생별로 row 생성 (모두 같은 session_id, 같은 내용)
    const rows = allIds.map(sid => ({
      student_id: sid,
      teacher_id: author.id,
      teacher_name: author.name,
      counsel_date: counselDate,
      counsel_type: counselType || '일반 상담',
      content: content.trim(),
      file_url: fileUrl,
      file_name: fileData ? (fileData.fileName || '') : '',
      session_id: sessionId,
      participants: participantsStr
    }));

    // session_id/participants 컬럼 없을 때 fallback
    let { error } = await supabase.from('counseling_logs').insert(rows);
    if (error && String(error.message || '').toLowerCase().match(/session_id|participants/)) {
      const fallbackRows = rows.map(r => {
        delete r.session_id;
        delete r.participants;
        return r;
      });
      const r2 = await supabase.from('counseling_logs').insert(fallbackRows);
      error = r2.error;
    }
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    const msg = allIds.length > 1
      ? `공동 상담 기록 저장 완료 (${allIds.length}명에게 동일하게 등록)`
      : '상담 기록이 저장되었습니다.';
    return res.json({ success: true, msg });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
