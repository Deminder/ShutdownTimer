UUID := $(shell grep uuid src/metadata.json | cut -d\" -f 4)
ZIP_FILE := $(UUID).shell-extension.zip
$(info Version: $(shell grep -oP '^ *?\"version\": *?\K(\d+)' src/metadata.json) ($(ZIP_FILE)))

UI_IN := src/ui/prefs.ui
GTK4_TOOL := $(shell which gtk4-builder-tool 2>/dev/null)
ifneq ($(GTK4_TOOL),)
UI_OUT := src/ui/prefs-gtk4.ui
else
$(info Skipping transform gtk3 to gtk4... gtk4-builder-tool not available!)
endif

SCHEMA_IN := src/schemas/$(shell grep settings-schema src/metadata.json | cut -d\" -f 4).gschema.xml
SCHEMA_OUT := src/schemas/gschemas.compiled

GETTEXTDOMAIN := $(shell grep gettext-domain src/metadata.json | cut -d\" -f 4)

OUTPUTS := $(UI_OUT) $(SCHEMA_OUT)
SOURCE_FILES := $(filter-out $(OUTPUTS),$(shell find src -type f) LICENSE)

target-zip=$(patsubst %,target/%/$(ZIP_FILE),$(1))
DEFAULT_ZIP := $(call target-zip,default)
DEBUG_ZIP := $(call target-zip,debug)

all: $(DEFAULT_ZIP) $(DEBUG_ZIP)

$(DEFAULT_ZIP) $(DEBUG_ZIP): $(OUTPUTS) $(SOURCE_FILES)
	@mkdir -p $(@D)
	@./scripts/pack.sh $(shell [ $(@D) = target/debug ] && echo "-d") -t $(@D)

zip: $(DEFAULT_ZIP)
debug-zip: $(DEBUG_ZIP)

lint:
	eslint src

$(SCHEMA_OUT): $(SCHEMA_IN)
	@echo "Compiling schemas..."
	glib-compile-schemas $(@D)

$(UI_OUT): $(UI_IN)
	@echo "Transforming gtk3 to gtk4..."
	$(GTK4_TOOL) simplify --3to4 $< > $@

LANGS := $(patsubst po/%.po,%,$(wildcard po/*.po))
$(info Translations: $(LANGS))

define INSTALL_EXTENSION
.PHONY: $(1)
$(1): $(2)
	@echo "Install extension$(3)..."
	@gnome-extensions install --force $(2) && \
		echo "Extension is installed$(3). Now restart the GNOME Shell." || (echo "ERROR: Could not install the extension!" && exit 1)
endef

$(eval $(call INSTALL_EXTENSION,install,$(DEFAULT_ZIP),))
$(eval $(call INSTALL_EXTENSION,debug-install,$(DEBUG_ZIP), with debug enabled))

clean:
	-rm -rf target
	-rm -f $(OUTPUTS) 
	-rm -rf src/locale

.PHONY: clean lint zip debug-zip
