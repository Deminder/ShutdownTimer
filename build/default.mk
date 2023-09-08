# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

PO_DIR ?= po
PO_FILES ?= $(wildcard $(PO_DIR)/*.po)
POT_MAIN ?= $(PO_DIR)/main.pot
SRC_DIR ?= src
SOURCE_FILES ?= $(filter-out %.mo %.compiled,$(shell find $(SRC_DIR) -type f))
TRANSLATABLE_FILES ?= $(filter %.js %.ui %.sh %.xml,$(SOURCE_FILES))
TRANSLATION_MODULE ?=
DEBUGMODE_MODULE ?= $(SRC_DIR)/modules/util.js
