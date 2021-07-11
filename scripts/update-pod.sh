#!/bin/bash

# Script to update main.pot and *.po files
#
# This Script is released under GPL v3 license
# Copyright (C) 2021 Javad Rahmatzadeh (changed)

set -e

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

xgettext \
    --from-code=UTF-8 \
    --copyright-holder="Shutdown Timer" \
    --package-name="Shutdown Timer" \
    --package-version="$(git describe --tags --abbrev=0)" \
    --output="po/main.pot" \
    ui/prefs.ui lib/*.js *.js schemas/*.xml

for file in po/*.po
do
    echo -n "Updating $(basename "$file" .po)"
    msgmerge -U "$file" po/main.pot
  
    if grep --silent "#, fuzzy" "$file"; then
        fuzzy+=("$(basename "$file" .po)")
    fi
done

if [[ -v fuzzy ]]; then
    echo "WARNING: Translations have unclear strings and need an update: ${fuzzy[*]}"
fi

