#!/bin/bash
# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

cd $(dirname ${BASH_SOURCE})

for t in *.test.js
do
	echo "-- TEST $t"
	OUTPUT=$(gjs -m $t 2>&1)
	[ $? = 1 ] && echo "$OUTPUT\n\n" && exit 1
done
echo "DONE"
