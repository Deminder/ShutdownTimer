# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

METADATA_FILE := $(SRC_DIR)/metadata.json
ifeq ($(wildcard $(METADATA_FILE)),)
	$(error No extension metadata file found: $(METADATA_FILE)!)
endif
setVersion = $(shell sed -Ei "s/(^ *?\"version\": *?)([0-9]+)(.*)/\1$(1)\3/" $(METADATA_FILE))
getMeta = $(shell grep "$(1)" $(METADATA_FILE) | cut -d\" -f 4)

setConst = $(let mtime,$(shell stat -c %y "$(1)"),\
					 $(shell sed -Ei "s/^((export )?const $(2) = ).*?;/\1$(3);/" "$(1)" && touch -d "$(mtime)" "$(1)"))

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


$(DEFAULT_ZIP) $(DEBUG_ZIP): $(SOURCE_FILES) $(MO_FILES) $(GSCHEMAS) $(GSCHEMAS_COMPILED)
	$(info Packing $(ZIP_FILE) version $(VERSION))
	@mkdir -p $(@D)
ifneq ($(strip $(TRANSLATION_MODULE)),)
	$(call setConst,$(TRANSLATION_MODULE),domain,\'$(GETTEXTDOMAIN)\')
	@echo $(TRANSLATION_MODULE): "$(shell grep -E 'const domain' $(TRANSLATION_MODULE))"
endif
	$(call setConst,$(DEBUGMODE_MODULE),debugMode,$(shell [ $(@D) = $(TARGET_DIR)/debug ] && echo "true" || echo "false"))
	@echo $(DEBUGMODE_MODULE): "$(shell grep -E 'export const debugMode' $(DEBUGMODE_MODULE))"

	@(cd $(SRC_DIR) && zip -r - . 2>/dev/null) > "$@"
	@zip -r "$@" LICENSES 2>&1 >/dev/null

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
			$^

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

lint:
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

NEXT_VERSION = $(shell echo 1 + $(VERSION) | bc)
release: $(DEFAULT_ZIP) | lint
	$(info Release version $(NEXT_VERSION))
	$(call setVersion,$(NEXT_VERSION))
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
	$(call setConst,$(DEBUGMODE_MODULE),debugMode,false)
	-rm -rf $(LOCALE_DIR)
	-rm -rf $(TARGET_DIR)
	-rm -f $(GSCHEMAS_COMPILED)

.PHONY: release clean lint po-lint zip debug-zip
