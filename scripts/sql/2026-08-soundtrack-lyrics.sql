-- Vocal Soundtracks: store lyrics + a hasVocals flag on generated songs.
-- Safe to run repeatedly.
ALTER TABLE soundtracks ADD COLUMN IF NOT EXISTS lyrics text;
ALTER TABLE soundtracks ADD COLUMN IF NOT EXISTS has_vocals boolean NOT NULL DEFAULT false;
