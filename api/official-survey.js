const { getSupabase, cors } = require('../lib/supabase');
const { handleAction } = require('../lib/official-surveys');

function clientIp(req) {
  const forwarded = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, msg: 'POST만 받을 수 있습니다.' });
  const result = await handleAction(getSupabase(), req.body || {}, { ip: clientIp(req), now: Date.now() });
  return res.status(result.status || 200).json(result.body);
};
