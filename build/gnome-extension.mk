# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

SHELL := /bin/bash

METADATA_FILE := $(SRC_DIR)/metadata.json
ifeq ($(wildcard $(METADATA_FILE)),)
	$(error No extension metadata file found: $(METADATA_FILE)!)
endif
getMeta = $(shell grep "$(1)" $(METADATA_FILE) | cut -d\" -f 4)


PACKAGE_NAME := $(call getMeta,name)
UUID := $(call getMeta,uuid)
GETTEXTDOMAIN := $(call getMeta,gettext-domain)
SCHEMA_FILE := $(SRC_DIR)/schemas/$(call getMeta,settings-schema).gschema.xml
ifeq ($(wildcard $(SCHEMA_FILE)),)
	$(info No settings schema found: SCHEMA_FILE)
endif
VERSION := $(shell grep -oP '^ *?\"version\": *?\K(\d+)' $(SRC_DIR)/metadata.json)

LOCALE_DIR := $(SRC_DIR)/locale
MO_FILES := $(patsubst $(PO_DIR)/%.po,$(LOCALE_DIR)/%/LC_MESSAGES/$(GETTEXTDOMAIN).mo,$(PO_FILES))
GSCHEMAS := $(wildcard $(SRC_DIR)/schemas/*.gschema.xml)
GSCHEMAS_COMPILED := $(SRC_DIR)/schemas/gschemas.compiled

ZIP_FILE := $(UUID).shell-extension.zip
TARGET_DIR := target
target-zip=$(patsubst %,$(TARGET_DIR)/%/$(ZIP_FILE),$(1))
DEFAULT_ZIP := $(call target-zip,default)
DEBUG_ZIP := $(call target-zip,debug)

all: $(DEFAULT_ZIP) $(DEBUG_ZIP)


.SILENT .NOTPARALLEL .ONESHELL: $(DEFAULT_ZIP) $(DEBUG_ZIP)
$(DEFAULT_ZIP) $(DEBUG_ZIP): $(SOURCE_FILES) $(GSCHEMAS) $(GSCHEMAS_COMPILED)
	set -e
	mkdir -p $(@D)
	function setConst() {
		local mtime=$$(stat -c %y "$$1")
		sed -Ei "s/^((export )?const $$2 = ).*?;/\1$$3;/" "$$1"
		touch -d "$$mtime" "$$1"
		echo $$1: "$$(grep -E 'const '$$2 $$1)"
	}
ifneq ($(strip $(TRANSLATION_MODULE)),)
	setConst $(TRANSLATION_MODULE) domain \'$(GETTEXTDOMAIN)\'
endif
	trap "setConst $(DEBUGMODE_MODULE) debugMode false" EXIT
	setConst $(DEBUGMODE_MODULE) debugMode $(shell [ $(@D) = $(TARGET_DIR)/debug ] && echo "true" || echo "false")

	echo -n "Packing $(ZIP_FILE) version $(VERSION) ... "
	(cd $(SRC_DIR) && zip -r - . 2>/dev/null) > "$@"
	zip -r "$@" LICENSES 2>&1 >/dev/null
	echo [OK]

zip: $(DEFAULT_ZIP)
debug-zip: $(DEBUG_ZIP)

$(POT_MAIN): $(TRANSLATABLE_FILES)
	@echo "Collecting translatable strings..."
	@xgettext \
			--from-code=UTF-8 \
			--copyright-holder="$(PACKAGE_NAME)" \
			--package-name="$(PACKAGE_NAME)" \
			--package-version="$(VERSION)" \
			--keyword="gtxt" \
			--keyword="_n:1,2" \
			--keyword="C_:1c,2" \
			--output="$@" \
			$(sort $^)

$(PO_FILES): $(POT_MAIN)
	@echo -n $(patsubst %.po,%,$(notdir $@))
	@msgmerge -U $@ $<
	@touch $@

$(MO_FILES): $(LOCALE_DIR)/%/LC_MESSAGES/$(GETTEXTDOMAIN).mo: $(PO_DIR)/%.po
	@mkdir -p $(@D)
	@msgfmt $< --output-file="$@" && echo "$(basename $(notdir $<)) [OK]"
	@touch $@

$(GSCHEMAS_COMPILED): $(GSCHEMAS)
	glib-compile-schemas --targetdir="$(@D)" $(SRC_DIR)/schemas

po-lint:
	$(let unclear,\
		$(shell grep -l "#, fuzzy" $(PO_FILES)),\
		$(if $(unclear),\
		@echo WARNING: Translations have unclear strings and need an update:\
		$(patsubst %.po,%,$(notdir $(unclear))) && exit 1))

.ONESHELL:
lint:
	@set -e
	reuse lint
	npm run lint
	npm run prettier

format:
	npm run lint:fix
	npm run prettier:fix

define INSTALL_EXTENSION
.PHONY: $(1)
$(1): $(2)
	@echo "Install extension$(3)..."
	@gnome-extensions install --force $(2) && \
		echo "Extension is installed$(3). Now restart the GNOME Shell." || (echo "ERROR: Could not install the extension!" && exit 1)
endef

$(eval $(call INSTALL_EXTENSION,install,$(DEFAULT_ZIP),))
$(eval $(call INSTALL_EXTENSION,debug-install,$(DEBUG_ZIP), with debug enabled))

.ONESHELL .SILENT .PHONY: supported-install
supported-install:
	set -e
	function hasVersionSupport() {
		python -c 'import json; import sys; any(sys.argv[1].startswith(v) for v in json.load(sys.stdin)["shell-version"]) or exit(1)' "$$1"
	}
	GNOME_VERSION=$$(gnome-shell --version | cut -d' ' -f3)
	if cat $(SRC_DIR)/metadata.json | hasVersionSupport "$$GNOME_VERSION"
	then
		make install
	else
		if [ -d .git ]
		then
			for version in {$(VERSION)..15}
			do
				tag=$$(git tag -l | grep -E "^(r|v)$$version$$" | head -n 1)
				if git show $${tag}:$(SRC_DIR)/metadata.json 2>/dev/null | hasVersionSupport "$$GNOME_VERSION"
				then
					git checkout "$$tag" || ( echo -e "\n\nFAILED install: could not checkout $${tag}!\n" && exit 1 )
					echo -e "\n\nInstalling $$tag for GNOME shell $$GNOME_VERSION"
					make install
					exit 0
				fi
			done
		fi
	fi
	echo "FAILED: No support for GNOME shell $$GNOME_VERSION" && exit 1

translations: $(MO_FILES) | po-lint

NEXT_VERSION = $(shell echo 1 + $(VERSION) | bc)
release: $(DEFAULT_ZIP) | translations lint
	set -e
	echo "Release version $(NEXT_VERSION)"
	# Set version in metadata file
	sed -Ei "s/(^ *?\"version\": *?)([0-9]+)(.*)/\1$(NEXT_VERSION)\3/" $(METADATA_FILE)
	@git add $(PO_DIR) $(METADATA_FILE)
	@git commit -am "Bump version to $(NEXT_VERSION)"
	@git tag -a "v$(NEXT_VERSION)" -m "Release version $(NEXT_VERSION)"

GUEST_SSHADDR ?= guest
GUEST_SSHCMD ?= ssh
debug-guest: $(DEBUG_ZIP)
	@echo Install $< on '$(GUEST_SSHADDR)' via '$(GUEST_SSHCMD)'
	@rsync -e "$(GUEST_SSHCMD)" $< $(GUEST_SSHADDR):~/Downloads/
	@$(GUEST_SSHCMD) "$(GUEST_SSHADDR)" "gnome-extensions install --force ~/Downloads/$(notdir $<) && killall -SIGQUIT gnome-shell"

clean:
	-rm -rf $(LOCALE_DIR)
	-rm -rf $(TARGET_DIR)
	-rm -f $(GSCHEMAS_COMPILED)

.PHONY: release clean translations lint po-lint zip debug-zip install
