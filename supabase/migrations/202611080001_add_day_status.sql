-- Add a constrained day status for user-selected personal leave.
-- Weekends and public holidays remain calendar-derived in the website and cannot be overridden there.
alter table public.timesheets
  add column if not exists day_status text not null default 'Working'
  check (day_status in ('Working', 'Personal leave'));

comment on column public.timesheets.day_status is
  'User-selectable status for ordinary weekdays; calendar weekends and public holidays are derived by the application.';
