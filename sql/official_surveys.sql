-- 공식 조사 2종 (2026 교육과정 만족도, 2027 참여예산제)
-- 기존 surveys / survey_logs 와 분리한다. 참여해도 마일리지는 나가지 않는다.
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요. 여러 번 실행해도 됩니다.
--
-- 접근: API(api/official-survey.js)만 SUPABASE_SERVICE_KEY(service role)로 읽고 씁니다.
-- service role 은 RLS를 우회하므로 아래 정책이 없어도 API는 동작합니다.
-- 브라우저에 이미 전달되는 anon 키로는 연락처 등 개인정보를 볼 수 없게 RLS를 켜 둡니다.
-- (예전 테이블은 RLS를 꺼 두었지만, 이 테이블은 학부모 연락처를 담으므로 막습니다.)

CREATE TABLE IF NOT EXISTS official_survey_responses (
  id BIGSERIAL PRIMARY KEY,
  survey_id TEXT NOT NULL CHECK (survey_id IN ('curriculum_sat_2026', 'budget_participation_2027')),
  respondent_type TEXT NOT NULL CHECK (respondent_type IN ('student', 'teacher', 'parent')),
  respondent_key TEXT NOT NULL,
  grade SMALLINT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_id, respondent_type, respondent_key)
);

CREATE INDEX IF NOT EXISTS idx_official_survey_group
  ON official_survey_responses (survey_id, respondent_type, grade);

CREATE TABLE IF NOT EXISTS official_survey_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  bucket TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_official_survey_rate_bucket
  ON official_survey_rate_limits (bucket, created_at DESC);

ALTER TABLE official_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE official_survey_rate_limits ENABLE ROW LEVEL SECURITY;

-- 공개 정책은 만들지 않습니다. anon / authenticated 는 기본 거부입니다.
REVOKE ALL ON TABLE official_survey_responses FROM anon, authenticated;
REVOKE ALL ON TABLE official_survey_rate_limits FROM anon, authenticated;

COMMENT ON TABLE official_survey_responses IS '공식 조사 응답. 교육과정 만족도는 결과 API에서 학번·이름을 내려주지 않는다. 참여예산제만 제안자 정보를 answers에 둔다.';
COMMENT ON TABLE official_survey_rate_limits IS '학부모 공개 제출용 IP 해시 속도 제한. 원문 IP는 저장하지 않는다.';
