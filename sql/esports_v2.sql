-- 이스포츠 신청 v2 (증분 마이그레이션) — sql/esports.sql 적용 후에 실행
--  1) esports_teams.game 허용값에 'caster'(중계) 추가
--  2) esports_members.birthdate DATE (발로란트 만 15세 확인용, NULL 허용)
--  3) esports_members.message TEXT (중계 지원 한마디, 선택)
-- 여러 번 실행해도 안전(idempotent). 기존 데이터는 변경하지 않음.
-- Supabase SQL Editor에서 직접 실행하세요. (배포 전 승인 후 적용)

-- game CHECK: 자동 생성된 이름이 달라도 pg_constraint에서 찾아서 지우고 다시 만든다.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.esports_teams'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%game%'
  LOOP
    EXECUTE format('ALTER TABLE public.esports_teams DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.esports_teams
    ADD CONSTRAINT esports_teams_game_check
    CHECK (game IN ('lol','brawl','steppin','valorant','caster'));
END $$;

ALTER TABLE public.esports_members ADD COLUMN IF NOT EXISTS birthdate DATE NULL;
ALTER TABLE public.esports_members ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
