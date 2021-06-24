#!/bin/sh
for s in scripts/*.sh; do
	if [[ "$s" != "scripts/update.sh" ]];then
		sh "$s"
	fi
done

