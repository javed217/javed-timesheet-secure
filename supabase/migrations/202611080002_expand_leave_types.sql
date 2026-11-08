-- Expand the existing day_status constraint to include all requested leave types.
-- Safe to run after 202611080001_add_day_status.sql. Existing rows are preserved.
ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_day_status_check;

ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_day_status_check
  CHECK (day_status IN (
    'Working',
    'Personal leave',
    'Emergency leave',
    'Paternity leave'
  ));

COMMENT ON COLUMN public.timesheets.day_status IS
  'User-selected leave status on ordinary working weekdays; weekends and public holidays are calendar-derived.';
