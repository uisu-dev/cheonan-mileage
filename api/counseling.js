const { getSupabase, cors, formatDate } = require('../lib/supabase');

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB (base64 인코딩 후 Vercel 4.5MB 한도 내 안전)

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'list') {
    const { studentId } = req.body;
    if (!studentId) return res.json({ success: false, msg: '학생 ID 누락' });
    const { data, error } = await supabase.from('counseling_logs')
      .select('*').eq('student_id', String(studentId))
      .order('counsel_date', { ascending: false }).limit(100);
    if (error) return res.json({ success: false, msg: error.message });
    return res.json({
      success: true,
      records: (data || []).map(r => ({
        id: r.id,
        teacherName: r.teacher_name || '',
        counselDate: r.counsel_date,
        counselDateStr: formatCounselDate(r.counsel_date),
        counselType: r.counsel_type || '일반 상담',
        content: r.content || '',
        fileUrl: r.file_url || '',
        fileName: r.file_name || '',
        sessionId: r.session_id || '',
        participants: r.participants || ''
      }))
    });
  }

  if (action === 'create') {
    const { studentId, participantIds, teacherName, counselDate, counselType, content, fileData } = req.body;
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
      teacher_name: teacherName || '',
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

  if (action === 'delete') {
    const { id, mode } = req.body; // mode: 'single' | 'all'
    const { data: row } = await supabase.from('counseling_logs').select('*').eq('id', id).single();
    if (!row) return res.json({ success: false, msg: '레코드를 찾을 수 없습니다.' });

    // 'all' + session_id 있으면 같은 세션 전체 삭제
    if (mode === 'all' && row.session_id) {
      // 파일 정리 (한 번만)
      if (row.file_url) {
        const idx = row.file_url.indexOf('/counseling-files/');
        if (idx !== -1) {
          const path = row.file_url.substring(idx + '/counseling-files/'.length);
          try { await supabase.storage.from('counseling-files').remove([decodeURIComponent(path)]); } catch (e) {}
        }
      }
      const { error, count } = await supabase.from('counseling_logs')
        .delete({ count: 'exact' }).eq('session_id', row.session_id);
      if (error) return res.json({ success: false, msg: error.message });
      return res.json({ success: true, msg: '공동 상담 ' + (count || 0) + '건 삭제 완료' });
    }

    // 단일 삭제 (파일은 다른 row가 같은 file_url을 참조하지 않을 때만 제거)
    if (row.file_url) {
      const { data: otherRefs } = await supabase.from('counseling_logs')
        .select('id').eq('file_url', row.file_url).neq('id', id).limit(1);
      if (!otherRefs || otherRefs.length === 0) {
        const idx = row.file_url.indexOf('/counseling-files/');
        if (idx !== -1) {
          const path = row.file_url.substring(idx + '/counseling-files/'.length);
          try { await supabase.storage.from('counseling-files').remove([decodeURIComponent(path)]); } catch (e) {}
        }
      }
    }
    await supabase.from('counseling_logs').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};

function formatCounselDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}
