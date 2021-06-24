#!/bin/sh
# package: intltool, (Poedit will do this also)
if [[ "$1" == "update" ]]; then
	cd ShutdownTimer@neumann || exit
	find . -name "*.js" -or -name "*.ui" -or -name "*.xml" | grep -v gtk4 | xargs xgettext -o shutdownTimerMessages.pot 
else
	echo "use Poedit to edit/update translations"
fi
