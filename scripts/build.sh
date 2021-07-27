#!/bin/bash

# Script to build the extension zip and install the package
#
# This Script is released under GPL v3 license
# Copyright (C) 2021 Javad Rahmatzadeh (changed)

set -e

while getopts id flag; do
    case $flag in
        d)
            DEBUG=1
            ;;
        i)
            INSTALL=1
            ;;
        *)  echo "ERROR: Invalid flag!"
            echo "Use '-i' to install the extension to your system."
            echo "To just build it, run the script without any flag."
            exit 1;;
    esac
done

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

echo "Compiling schemas..."
glib-compile-schemas schemas/

echo "Transform gtk3 to gtk4"
gtk4-builder-tool simplify --3to4 ui/prefs.ui > ui/prefs-gtk4.ui

echo "Generating translations..."
scripts/generate-mo.sh

function setDebugMode() {
    [[ "$1" = "true" ]] && NEGATION="false" || NEGATION="true"
    sed -i "s/let debugMode = $NEGATION;/let debugMode = $1;/g" lib/Convenience.js

}

if [ ! -z "$DEBUG" ]; then
    echo "Enabling debugMode..."
    trap "setDebugMode false" EXIT
    setDebugMode "true"
fi

echo "Packing extension..."
gnome-extensions pack \
    --force \
    --extra-source="bin" \
    --extra-source="lib" \
    --extra-source="ui" \
    --extra-source="tool" \
    --extra-source="polkit" \
    --extra-source="LICENSE" \
    --extra-source="README.md" \
    --extra-source="CHANGELOG.md"

UUID=$(grep uuid metadata.json | cut -d\" -f 4)
ZIPFILE="$UUID".shell-extension.zip
zip -d "$ZIPFILE" bin/*.png ui/#prefs.ui# ui/prefs.ui~ || true
echo "Packing Done!"

if [ ! -z "$INSTALL" ]; then
    gnome-extensions install \
        --force "$ZIPFILE"  && \
        echo "Extension is installed. Now restart the GNOME Shell." || \
        { echo "ERROR: Could not install the extension!"; exit 1; }
fi

