-- SDQ-Kr 자기보고용(11~17세) 정기 설문 응답
-- 공식 조사(official_survey_responses)와 분리한다. 참여해도 마일리지는 나가지 않는다.
-- 학번·이름·학년·반·번호와 25문항 응답을 실명으로 저장한다. 회차(wave)마다 학생 1행.
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요. 여러 번 실행해도 됩니다.
--
-- 접근: API(api/sdq.js)만 SUPABASE_SERVICE_KEY(service role)로 읽고 씁니다.
-- service role 은 RLS를 우회하므로 아래 정책이 없어도 API는 동작합니다.
-- 브라우저에 전달되는 anon 키로는 정신건강 응답을 볼 수 없게 RLS를 켜 둡니다.

CREATE TABLE IF NOT EXISTS sdq_responses (
  id BIGSERIAL PRIMARY KEY,
  wave TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade SMALLINT NOT NULL,
  class_no SMALLINT NOT NULL,
  number SMALLINT NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wave, student_id)
);

CREATE INDEX IF NOT EXISTS idx_sdq_responses_wave_class
  ON sdq_responses (wave, grade, class_no);

ALTER TABLE sdq_responses ENABLE ROW LEVEL SECURITY;

-- 공개 정책은 만들지 않습니다. anon / authenticated 는 기본 거부입니다.
REVOKE ALL ON TABLE sdq_responses FROM anon, authenticated;

COMMENT ON TABLE sdq_responses IS 'SDQ-Kr 자기보고 응답. 실명·학번을 담는다. service role API만 접근하고, 결과 열람은 서버 허용 교사만 가능하다.';
