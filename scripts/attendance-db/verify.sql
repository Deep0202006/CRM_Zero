\set ON_ERROR_STOP on

insert into public.attendance(
  attendance_id,user_id,date,clock_in,selfie_url,latitude,longitude,selfie_captured,selfie_storage_path,selfie_uploaded_at,selfie_purge_state
) values (
  '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','2026-08-02','2026-08-02T04:00:00Z',null,18.5204,73.8567,true,
  'attendance/00000000-0000-4000-8000-000000000001/2026-08-02/00000000-0000-4000-8000-000000000011.jpg','2026-08-02T04:01:00Z','available'
);

do $$ begin
  begin
    insert into public.attendance(attendance_id,user_id,date,clock_in,selfie_url)
    values ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','2026-08-02','2026-08-02T04:02:00Z',null);
    raise exception 'duplicate user/date Attendance accepted';
  exception when unique_violation then null; end;
end $$;

update public.attendance
set selfie_purged_at='2026-08-07T04:01:00Z',selfie_purge_state='purged',selfie_purge_started_at=null
where attendance_id='00000000-0000-4000-8000-000000000011';

do $$ begin
  if (select count(*) from public.attendance) <> 2 then raise exception 'Attendance business row count changed'; end if;
  if not exists (
    select 1 from public.attendance
    where attendance_id='00000000-0000-4000-8000-000000000011'
      and user_id='00000000-0000-4000-8000-000000000001'
      and date='2026-08-02' and clock_in='2026-08-02T04:00:00Z'
      and selfie_purged_at is not null and selfie_purge_state='purged'
  ) then raise exception 'Evidence purge changed or lost Attendance authority'; end if;
end $$;
