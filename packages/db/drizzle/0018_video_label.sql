-- Per-clip label so an operator can name each generated segment before downloading it
-- for offsite editing (CapCut/Descript). Used to build the download filename.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS label text;
