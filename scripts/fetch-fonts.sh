#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../public/fonts"
base=https://raw.githubusercontent.com/google/fonts/main
curl -sSLo Fredoka.ttf     "$base/ofl/fredoka/Fredoka%5Bwdth%2Cwght%5D.ttf"
curl -sSLo Baloo2.ttf      "$base/ofl/baloo2/Baloo2%5Bwght%5D.ttf"
curl -sSLo Chewy.ttf       "$base/apache/chewy/Chewy-Regular.ttf"
curl -sSLo Bangers.ttf     "$base/ofl/bangers/Bangers-Regular.ttf"
curl -sSLo LilitaOne.ttf   "$base/ofl/lilitaone/LilitaOne-Regular.ttf"
curl -sSLo LuckiestGuy.ttf "$base/apache/luckiestguy/LuckiestGuy-Regular.ttf"

# Licence texts, one per family (see LICENSES.md for the summary table).
mkdir -p licenses
curl -sSLo licenses/Fredoka.txt     "$base/ofl/fredoka/OFL.txt"
curl -sSLo licenses/Baloo2.txt      "$base/ofl/baloo2/OFL.txt"
curl -sSLo licenses/Chewy.txt       "$base/apache/chewy/LICENSE.txt"
curl -sSLo licenses/Bangers.txt     "$base/ofl/bangers/OFL.txt"
curl -sSLo licenses/LilitaOne.txt   "$base/ofl/lilitaone/OFL.txt"
curl -sSLo licenses/LuckiestGuy.txt "$base/apache/luckiestguy/LICENSE.txt"
ls -la . licenses
