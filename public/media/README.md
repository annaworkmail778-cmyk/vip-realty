# Media

Most of this folder is **machine-generated placeholder art**, produced by
`npm run media` (see `scripts/media/`). Anything listed in `installed.json` is
real footage that was supplied and encoded for the site — the generator will
not touch those files.

**Real so far:** the hero still, the three section 02 intent loops and the
section 04 scroll-scrubbed clip.
**Still placeholder:** everything else. None of it is photography of a real
property, and none of it should ship.

**Listing photographs are not in this folder.** They are stored in the Supabase
Storage bucket `property-images` and attached to listings in the database.
`properties/` holds only legacy photographs of the former hard-coded demo
listings; the site no longer uses them and they are kept temporarily for
reference.

## Replacing it

Drop a real file at the same path, keep roughly the same aspect ratio, and the
site picks it up — every path resolves through `lib/media.ts`, so no component
changes are needed. Delete nothing else.

| Path | Used by | Ratio | Suggested size |
| --- | --- | --- | --- |
| `hero/hero-loop.mp4` · `.webm` | 01 Hero background | 16:9 | 1920×1080, 10–20 s, muted, seamless loop |
| `hero/hero-poster.jpg` | 01 Hero first paint | 16:9 | 2560×1440 |
| `hero/evening.jpg` | 09 Final CTA | 16:9 | 2560×1440 |
| `hero/og.jpg` | Social preview | 1.91:1 | 1200×630 |
| `transformation/transformation.mp4` · `.webm` | 04 Scroll-scrubbed sequence | 16:9 | **installed** — 1280×720, 6.5 s |
| `transformation/poster.jpg` | 04 First frame | 16:9 | taken from the clip |
| `interior/buy.jpg` · `rent.jpg` · `land.jpg` | 02 Search intent | 4:5 | 1800×2250 |
| `collection/*.jpg` | 05 Collection | 4:5 | 1500×1900 |
| `team/team.jpg` | 06 About | 16:10 | 2400×1500 |
| `brand/vip-realty.svg` | Reference lockup | — | the agency's own artwork |

## Installing real footage

```bash
npm run media:video -- scrub <file.mp4> [--trim 1.5] [--width 1280]
npm run media:video -- hero  <file.mp4>
npm run media:video -- buy|rent|land <file.mp4>
```

Each target encodes for its job. The section 02 intent loops are downscaled to
960px and compressed hard, because they are never drawn much wider than 420px
and sit below the fold; they ship as MP4 only, since VP9 came out larger than
h264 at that size and h264 plays everywhere.

This encodes the source for its job, writes MP4 + WebM + poster frames, and
records it in `installed.json` so `npm run media` skips it from then on. Use
`--trim` to drop seconds off the front — useful when the source opens on a
title card or a burned-in caption.

## The scroll-scrubbed clip (04)

This one has requirements beyond looking good, all of which the install script
applies for you:

- **Dense keyframes.** A short GOP (`-g 4`) or scrubbing stutters, because
  every scroll tick seeks.
- **No audio**, `-pix_fmt yuv420p`, and `-movflags +faststart`.
- **Short.** 6–10 seconds is plenty; the scroll distance stretches it.
- It should read as one continuous move from a bare shell to a finished room:
  empty space → structure → materials → furniture → light → home.

The clip currently installed is exactly that: a concrete shell with a city and
mountain view that becomes a finished interior. Its first 1.5 seconds were
trimmed to drop a burned-in "EMPTY SPACE" caption, since the page prints that
label itself.

## The hero clip (01)

A slow, continuous camera move through an interior that opens onto a view. It
autoplays muted and loops, so it must not have a visible cut at the loop point,
and it is skipped entirely for visitors who prefer reduced motion.

## Regenerating the placeholders

```bash
npm run media           # everything except installed footage
npm run media -- images # stills only (fast)
npm run media -- video  # the placeholder clips
```

The look is defined in `scripts/media/scenes.mjs`; the brand tones it draws
from are in `scripts/media/palette.mjs`.
