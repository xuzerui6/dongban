# Outfit Preset assets

Production avatars are full-character PNG files. Add each asset at:

`{gender}/{outfit}/{view}.png`

- `gender`: `male` or `female`
- `outfit`: `default`, `penguin`, `sakura`, or `sunset_sakura`
- `view`: `front` or `side`

`default` currently contains both views for both genders. Missing preset views are handled by `src/lib/outfits.ts`: the other view of the same preset is tried first, followed by the same gender's `default/front.png`.
