create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  full_name text not null,
  grade text,
  phone text,
  guardian_phone text,
  last_login timestamptz,
  role text not null default 'student' check (role in ('student', 'teacher')),
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists guardian_phone text;
alter table public.profiles add column if not exists last_login timestamptz;
alter table public.profiles alter column status set default 'approved';
update public.profiles set status = 'approved' where role = 'student' and status <> 'approved';

create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.join_requests alter column status set default 'approved';
update public.join_requests set status = 'approved' where status <> 'approved';

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  position integer not null check (position >= 0),
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  correct_index integer not null check (correct_index >= 0 and correct_index < jsonb_array_length(options)),
  unique (test_id, position)
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null default '',
  url text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  test_id uuid references public.tests(id) on delete set null,
  test_title text not null,
  score integer not null check (score >= 0),
  total integer not null check (total > 0),
  percentage integer not null check (percentage between 0 and 100),
  created_at timestamptz not null default now()
);

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'teacher'
  );
$$;

create or replace function public.record_login()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  login_time timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  update public.profiles
  set last_login = login_time
  where id = (select auth.uid());
  if not found then raise exception 'Profile not found'; end if;
  return login_time;
end;
$$;

create or replace function public.is_approved_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'student'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_name text := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  new_username text;
begin
  new_username := new_name;
  if new_name = '' then
    raise exception 'A full name is required';
  end if;

  insert into public.profiles (id, username, full_name, grade, phone, guardian_phone, status)
  values (
    new.id,
    new_username,
    new_name,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'grade', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'guardian_phone', '')), ''),
    'approved'
  );

  insert into public.join_requests (student_id, status) values (new.id, 'approved');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_madar on auth.users;
create trigger on_auth_user_created_madar
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.join_requests enable row level security;
alter table public.tests enable row level security;
alter table public.test_questions enable row level security;
alter table public.videos enable row level security;
alter table public.scores enable row level security;

drop policy if exists "profiles_read_self_or_teacher" on public.profiles;
create policy "profiles_read_self_or_teacher" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_teacher());
drop policy if exists "teachers_update_profiles" on public.profiles;
create policy "teachers_update_profiles" on public.profiles
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "teachers_delete_profiles" on public.profiles;
create policy "teachers_delete_profiles" on public.profiles
  for delete to authenticated using (public.is_teacher());

drop policy if exists "requests_read_self_or_teacher" on public.join_requests;
drop policy if exists "teachers_update_requests" on public.join_requests;
revoke all on public.join_requests from authenticated;

drop policy if exists "tests_read_approved_or_teacher" on public.tests;
create policy "tests_read_approved_or_teacher" on public.tests
  for select to authenticated using (public.is_teacher() or public.is_approved_student());
drop policy if exists "teachers_manage_tests" on public.tests;
create policy "teachers_manage_tests" on public.tests
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "teachers_manage_questions" on public.test_questions;
create policy "teachers_manage_questions" on public.test_questions
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "videos_read_approved_or_teacher" on public.videos;
create policy "videos_read_approved_or_teacher" on public.videos
  for select to authenticated using (public.is_teacher() or public.is_approved_student());
drop policy if exists "teachers_manage_videos" on public.videos;
create policy "teachers_manage_videos" on public.videos
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "scores_read_self_or_teacher" on public.scores;
create policy "scores_read_self_or_teacher" on public.scores
  for select to authenticated using (student_id = (select auth.uid()) or public.is_teacher());

create or replace function public.get_test_questions(p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (public.is_teacher() or public.is_approved_student()) then
    raise exception 'Account is not approved to access tests';
  end if;
  if not exists (select 1 from public.tests where id = p_test_id) then
    raise exception 'Test not found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'text', q.question_text,
        'options', q.options
      ) || case when public.is_teacher()
        then jsonb_build_object('correct', q.correct_index)
        else '{}'::jsonb
      end
      order by q.position
    ),
    '[]'::jsonb
  )
  into result
  from public.test_questions q
  where q.test_id = p_test_id;

  return result;
end;
$$;

create or replace function public.save_test(
  p_test_id uuid,
  p_title text,
  p_topic text,
  p_description text,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
  question jsonb;
  question_position integer := 0;
begin
  if not public.is_teacher() then
    raise exception 'Only the teacher can manage tests';
  end if;
  if trim(coalesce(p_title, '')) = '' or trim(coalesce(p_topic, '')) = '' then
    raise exception 'Test title and topic are required';
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'At least one question is required';
  end if;

  if p_test_id is null then
    insert into public.tests (title, topic, description)
    values (trim(p_title), trim(p_topic), coalesce(p_description, ''))
    returning id into saved_id;
  else
    update public.tests
    set title = trim(p_title), topic = trim(p_topic),
        description = coalesce(p_description, ''), updated_at = now()
    where id = p_test_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Test not found'; end if;
    delete from public.test_questions where test_id = saved_id;
  end if;

  for question in select value from jsonb_array_elements(p_questions)
  loop
    if trim(coalesce(question ->> 'text', '')) = ''
      or jsonb_typeof(question -> 'options') <> 'array'
      or jsonb_array_length(question -> 'options') < 2
      or (question ->> 'correct')::integer < 0
      or (question ->> 'correct')::integer >= jsonb_array_length(question -> 'options')
    then
      raise exception 'Invalid question data';
    end if;
    insert into public.test_questions (test_id, position, question_text, options, correct_index)
    values (saved_id, question_position, question ->> 'text', question -> 'options', (question ->> 'correct')::integer);
    question_position := question_position + 1;
  end loop;
  return saved_id;
end;
$$;

drop function if exists public.review_join_request(uuid, text);

create or replace function public.submit_test(p_test_id uuid, p_answers integer[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  question public.test_questions%rowtype;
  answer_index integer := 1;
  total_count integer := 0;
  correct_count integer := 0;
  test_name text;
  result jsonb;
begin
  if not public.is_approved_student() then
    raise exception 'Only approved students can submit tests';
  end if;
  select title into test_name from public.tests where id = p_test_id;
  if test_name is null then raise exception 'Test not found'; end if;

  for question in
    select * from public.test_questions where test_id = p_test_id order by position
  loop
    if coalesce(p_answers[answer_index], -1) < 0
      or coalesce(p_answers[answer_index], -1) >= jsonb_array_length(question.options)
    then
      raise exception 'Every question must have a valid answer';
    end if;
    if p_answers[answer_index] = question.correct_index then
      correct_count := correct_count + 1;
    end if;
    total_count := total_count + 1;
    answer_index := answer_index + 1;
  end loop;

  if total_count = 0 or coalesce(array_length(p_answers, 1), 0) <> total_count then
    raise exception 'Answer count does not match test';
  end if;

  insert into public.scores (student_id, test_id, test_title, score, total, percentage)
  values ((select auth.uid()), p_test_id, test_name, correct_count, total_count, round(correct_count * 100.0 / total_count)::integer);

  select jsonb_build_object(
    'score', correct_count,
    'total', total_count,
    'percentage', round(correct_count * 100.0 / total_count)::integer
  ) into result;
  return result;
end;
$$;

grant execute on function public.get_test_questions(uuid) to authenticated;
grant execute on function public.save_test(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.submit_test(uuid, integer[]) to authenticated;

grant usage on schema public to authenticated;
revoke all on public.profiles, public.join_requests, public.tests,
  public.test_questions, public.videos, public.scores from anon;
grant select, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.tests to authenticated;
grant select, insert, update, delete on public.test_questions to authenticated;
grant select, insert, update, delete on public.videos to authenticated;
grant select on public.scores to authenticated;

revoke all on function public.is_teacher() from public, anon;
revoke all on function public.is_approved_student() from public, anon;
revoke all on function public.record_login() from public, anon;
revoke all on function public.handle_new_user() from public, anon;
revoke all on function public.get_test_questions(uuid) from public, anon;
revoke all on function public.save_test(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.submit_test(uuid, integer[]) from public, anon;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.is_approved_student() to authenticated;
grant execute on function public.record_login() to authenticated;
