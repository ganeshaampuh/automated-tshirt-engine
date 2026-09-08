#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../public/fonts"
base=https://raw.githubusercontent.com/google/fonts/main

# Static instances only — never a variable font. skia (@napi-rs/canvas) ignores the `wght` axis and
# would print the default instance for every weight, so the print would not match the preview.
#
# google/fonts ships Fredoka and Baloo 2 as variable fonts only (`ofl/<family>/` has no `static/`
# directory), so their static instances come from the same upstream repositories google/fonts
# itself packages from, pinned to the commit named in each family's METADATA.pb. Same designers,
# same version, same licence.
fredoka=https://raw.githubusercontent.com/hafontia-zz/Fredoka-One/35c584ff23450c9bcdf8819706e12fcdeefe1712/fonts/ttf
baloo2=https://raw.githubusercontent.com/yanone/Baloo2-Variable/da523dfa21aa0e376253d61c21e39146dc55702a/fonts/ttf/Baloo2

curl -fsSLo Fredoka-Regular.ttf   "$fredoka/Fredoka-Regular.ttf"
curl -fsSLo Fredoka-Bold.ttf      "$fredoka/Fredoka-Bold.ttf"
curl -fsSLo Baloo2-Regular.ttf    "$baloo2/Baloo2-Regular.ttf"
curl -fsSLo Baloo2-Bold.ttf       "$baloo2/Baloo2-Bold.ttf"
curl -fsSLo Baloo2-ExtraBold.ttf  "$baloo2/Baloo2-ExtraBold.ttf"

# Single-weight display faces: google/fonts is the source.
curl -fsSLo Chewy.ttf       "$base/apache/chewy/Chewy-Regular.ttf"
curl -fsSLo Bangers.ttf     "$base/ofl/bangers/Bangers-Regular.ttf"
curl -fsSLo LilitaOne.ttf   "$base/ofl/lilitaone/LilitaOne-Regular.ttf"
curl -fsSLo LuckiestGuy.ttf "$base/apache/luckiestguy/LuckiestGuy-Regular.ttf"

# Licence texts, one per family (see LICENSES.md for the summary table).
mkdir -p licenses
curl -fsSLo licenses/Fredoka.txt     "$base/ofl/fredoka/OFL.txt"
curl -fsSLo licenses/Baloo2.txt      "$base/ofl/baloo2/OFL.txt"
curl -fsSLo licenses/Chewy.txt       "$base/apache/chewy/LICENSE.txt"
curl -fsSLo licenses/Bangers.txt     "$base/ofl/bangers/OFL.txt"
curl -fsSLo licenses/LilitaOne.txt   "$base/ofl/lilitaone/OFL.txt"
curl -fsSLo licenses/LuckiestGuy.txt "$base/apache/luckiestguy/LICENSE.txt"
ls -la . licenses
