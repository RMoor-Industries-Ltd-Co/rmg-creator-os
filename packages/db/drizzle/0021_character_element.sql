-- Reference-element id per character (two-in-a-frame): unlike a Soul (one identity per
-- generation), an Element is embedded as a <<<element_id>>> placeholder in the prompt, so
-- multiple characters can appear in one shot with an element-capable model.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS element_id text;
