-- SDQ 같은 회차 재응답을 학생당 한 행으로 유지한다.
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요. 여러 번 실행해도 됩니다.
-- sql/sdq_responses.sql 로 만든 테이블이면 UNIQUE (wave, student_id) 와 updated_at 이 이미 있습니다.
-- 그 경우 아래는 중복이 없을 때 데이터를 바꾸지 않습니다.
-- 제약이 없던 테이블이면, 같은 학생·회차의 중복 행은 가장 최근 1건만 남기고 제약을 추가합니다.
-- 새로 생기는 updated_at 은 created_at 과 같게 채워, 기존 응답을 재응답으로 오인하지 않습니다.
-- anon / authenticated 권한은 바꾸지 않습니다. 읽기·쓰기는 service role API만 합니다.

DO $$
BEGIN
  IF to_regclass('public.sdq_responses') IS NULL THEN
    RAISE EXCEPTION 'sdq_responses 테이블이 없습니다. sql/sdq_responses.sql 을 먼저 실행하세요.';
  END IF;
END $$;

ALTER TABLE sdq_responses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE sdq_responses
SET updated_at = COALESCE(created_at, NOW())
WHERE updated_at IS NULL;

DELETE FROM sdq_responses AS older
USING sdq_responses AS newer
WHERE older.wave = newer.wave
  AND older.student_id = newer.student_id
  AND (
    COALESCE(older.updated_at, older.created_at, '-infinity'::timestamptz)
      < COALESCE(newer.updated_at, newer.created_at, '-infinity'::timestamptz)
    OR (
      COALESCE(older.updated_at, older.created_at, '-infinity'::timestamptz)
        = COALESCE(newer.updated_at, newer.created_at, '-infinity'::timestamptz)
      AND older.id < newer.id
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sdq_responses'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(wave, student_id)%'
  ) THEN
    ALTER TABLE sdq_responses
      ADD CONSTRAINT sdq_responses_wave_student_id_key UNIQUE (wave, student_id);
  END IF;
END $$;

ALTER TABLE sdq_responses ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sdq_responses'
      AND column_name = 'updated_at'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE sdq_responses ALTER COLUMN updated_at SET NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN sdq_responses.updated_at IS '마지막 제출 시각. 같은 회차에 다시 제출하면 created_at 보다 늦고, 답과 점수는 이 행만 다시 계산한다.';
