-- Add formats and audiences columns to titles table
ALTER TABLE titles 
ADD COLUMN IF NOT EXISTS formats TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS audiences TEXT[] DEFAULT '{}';

-- Create index for faster searching on new columns
CREATE INDEX IF NOT EXISTS idx_titles_formats ON titles USING GIN (formats);
CREATE INDEX IF NOT EXISTS idx_titles_audiences ON titles USING GIN (audiences);


