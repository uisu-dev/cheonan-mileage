const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { studentId, studentName, content, fileData } = req.body;
  const supabase = getSupabase();

  try {
    let fileUrl = '';

    if (fileData && fileData.data) {
      const buffer = Buffer.from(fileData.data, 'base64');
      const fileName = `report_${studentId}_${Date.now()}.jpg`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('reports')
        .upload(fileName, buffer, {
          contentType: fileData.mimeType,
          upsert: false
        });

      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage
          .from('reports')
          .getPublicUrl(fileName);
        fileUrl = urlData.publicUrl;
      }
    }

    await supabase.from('reports').insert({
      reporter_id: studentId, reporter_name: studentName, content, file_link: fileUrl
    });

    return res.json({ success: true, msg: '제보가 접수되었습니다.' });
  } catch (e) {
    return res.json({ success: false, msg: '오류: ' + e.message });
  }
};
