# Packet fixtures

- `film-round/metrics.json`: real `mf-motion measure --profile film --expected 4` output for a 4 s FFmpeg `testsrc2` render (1280x720, 30 fps).

`test/unit/quality/packet/packet.test.ts` copies `test/fixtures/projects/film` into a temp folder, adds storylines and notes with sentinel text, and builds `rounds/1/` from this metrics file plus sheet images it generates with FFmpeg (no binary images are committed).
