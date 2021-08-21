#!/bin/bash

# Script to bump version and prepare release
#
# This Script is released under GPL v3 license
# Copyright (C) 2021 Deminder

set -e

# release should be on master branch
[[ `git branch --show-current` == 'master' ]] || ( echo "Expected branch: master" >&2 && exit 1 )

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

VPATTERN='^ *?\"version\": *?'
METADATA_FILE=src/metadata.json
VERSION=$(( 1 + `grep -oP "$VPATTERN"'\K(\d+)' "$METADATA_FILE"` ))
echo "New version: $VERSION"
sed -Ei "s/($VPATTERN)([0-9]+)(.*)/\1$VERSION\3/" "$METADATA_FILE"
git add "$METADATA_FILE"

# update translations
./scripts/update-pod.sh
git add po

git commit -m "bump version to $VERSION"
git tag -a "r$VERSION" -m "Release version $VERSION"
