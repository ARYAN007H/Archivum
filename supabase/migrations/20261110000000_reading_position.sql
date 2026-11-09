-- Exact reading position for cross-device resume. The app stores
-- {chapterIndex, charStart} — a character offset that survives font-size
-- changes and repagination, unlike the coarse current_page composite.
-- Nullable: older rows keep working and fall back to current_page.
alter table public.reading_progress add column if not exists position jsonb;
