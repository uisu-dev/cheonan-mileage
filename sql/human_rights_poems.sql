-- 인권 생활시 제출 + 챗봇 쿨다운 (학생 ~600명 동시 대비)
-- Supabase SQL Editor에서 실행하세요. (배포 전 승인 후 적용)

CREATE TABLE IF NOT EXISTS human_rights_poems (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  student_name TEXT NOT NULL DEFAULT '',
  poem TEXT NOT NULL,
  chat_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_human_rights_poems_updated
  ON human_rights_poems (updated_at DESC);

-- 학생당 챗봇 호출 간격 (기본 3초)
CREATE TABLE IF NOT EXISTS poem_chat_throttle (
  student_id TEXT PRIMARY KEY,
  last_chat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE human_rights_poems DISABLE ROW LEVEL SECURITY;
ALTER TABLE poem_chat_throttle DISABLE ROW LEVEL SECURITY;
