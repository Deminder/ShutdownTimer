# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

include build/default.mk

TRANSLATION_MODULE := $(SRC_DIR)/modules/translation.js

include build/gnome-extension.mk

test:
	@./tests/test.sh

.PHONY: test
