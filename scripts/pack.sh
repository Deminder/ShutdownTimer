#!/bin/bash

# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from JustPerfection 2021 by Javad Rahmatzadeh

set -e

targetdir="."
while getopts "dt:" flag; do
    case $flag in
        d)
            DEBUG=1
            ;;
        t)
            targetdir=${OPTARG}
            ;;
        h|*)  
            echo "ERROR: Invalid flag!"
            echo "Use '-d' to pack with debug enabled."
            echo "Use '-t <path>' to change target dir. (default: .)"
            exit 1
            ;;
    esac
done

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

function setDebugMode() {
    [[ "$1" = "true" ]] && negation="false" || negation="true"
    file=src/lib/Convenience.js
    mtime=$(stat -c %y "$file")
    sed -i "s/let debugMode = $negation;/let debugMode = $1;/g" "$file"
    touch -d "$mtime" "$file"
}

if [ ! -z "$DEBUG" ]; then
    echo "Enabling debugMode..."
    trap "setDebugMode false" EXIT
    setDebugMode "true"
fi

echo "Packing extension..."
gnome-extensions pack src \
    --force \
    --podir="../po" \
    --extra-source="bin" \
    --extra-source="lib" \
    --extra-source="icons" \
    --extra-source="ui" \
    --extra-source="tool" \
    --extra-source="polkit" \
    --extra-source="../LICENSES" \
    --extra-source="../CHANGELOG.md" \
    --out-dir="$targetdir"

uuid=$(grep uuid src/metadata.json | cut -d\" -f 4)
zipfile="${targetdir}/${uuid}.shell-extension.zip"
zip -d "$zipfile" ui/#prefs.ui# ui/prefs.ui~ || true
echo "Packing Done!"

