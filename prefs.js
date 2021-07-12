const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Convenience = Me.imports.lib.Convenience;

const { GLib, GObject, Gtk } = imports.gi;

const Gettext = imports.gettext.domain("ShutdownTimer");
const _ = Gettext.gettext;

var settings;
var MODE_LABELS;
function init() {
  ExtensionUtils.initTranslations();
  imports.gettext.textdomain(Me.metadata["gettext-domain"]);
  settings = ExtensionUtils.getSettings();
}

const templateComponents = {
  "shutdown-max-timer": "adjustment",
  "shutdown-slider": "adjustment",
  "show-settings": "switch",
  "root-mode": "switch",
  "show-shutdown-mode": "buffer",
  "show-shutdown-slider": "switch",
  "show-textboxes": "switch",
  "check-command": "buffer",
  "enable-check-command": "switch",
  "shutdown-mode": "combo",
  "auto-wake": "switch",
  "wake-max-timer": "adjustment",
  "wake-slider": "adjustment",
  "show-wake-slider": "switch",
  "show-wake-items": "switch",
  "install-policy": "switch",
};

const templateFile = Me.dir
  .get_child("ui")
  .get_child("prefs" + (Gtk.get_major_version() < 4 ? "" : "-gtk4") + ".ui")
  .get_uri();

const ShutdownTimerPrefsWidget = GObject.registerClass(
  {
    Name: "ShutdownTimer.Prefs.Widget",
    GTypeName: "ShutdownTimerPrefsWidget",
    Template: templateFile,
    InternalChildren: Object.entries(templateComponents)
      // entries only required for placeholder fix
      .flatMap(([b, c]) =>
        c === "buffer"
          ? [
              [b, "entry"],
              [b, c],
            ]
          : [[b, c]]
      )
      .map((n) => n.join("-"))
      .concat(
        "rpm-ostree-hint-label",
        "install-log-text-buffer",
        "installer-scrollbar-adjustment"
      ),
  },
  class ShutdownTimerPrefsWidget extends Gtk.Grid {
    _init(params = {}) {
      super._init(params);
      this.handlers = [];
      this.settingsHandlerIds = [];

      const connectFuncs = {
        adjustment: [
          (v) => v.get_value(),
          (v, s) => v.set_value(s),
          (sn) => settings.get_int(sn),
          (sn, v) => settings.set_int(sn, v),
          "value-changed",
        ],
        switch: [
          (v) => v.get_active(),
          (v, s) => v.set_active(s),
          (sn) => settings.get_boolean(sn),
          (sn, v) => settings.set_boolean(sn, v),
          "notify::active",
        ],
        buffer: [
          (v) => v.get_text(),
          (v, s) => v.set_text(s, -1),
          (sn) => settings.get_string(sn),
          (sn, v) => settings.set_string(sn, v),
          "notify::text",
        ],
        combo: [
          (v) => v.get_active_id(),
          (v, s) => v.set_active_id(s),
          (sn) => settings.get_string(sn),
          (sn, v) => settings.set_string(sn, v),
          "changed",
        ],
      };

      const fieldNameByInteralID = (internalID) => {
        const fieldName = "_" + internalID.replaceAll("-", "_");
        if (!(fieldName in this) || this[fieldName] === null) {
          throw new Error(
            `Template Error '${templateFile}': '${fieldName}' not found in ${JSON.stringify(
              this
            )}`
          );
        }
        return fieldName;
      };

      const connect_comp = (baseName, component) => {
        const [
          fieldGetter,
          fieldSetter,
          settingsGetter,
          settingsSetter,
          signal,
        ] = connectFuncs[component];
        const settingsName = `${baseName}-value`;
        const fieldName = fieldNameByInteralID(`${baseName}-${component}`);
        const fieldValue = settingsGetter(settingsName);
        const comp = this[fieldName];
        if (baseName === "shutdown-mode") {
          // update combo box entries
          comp.remove_all();
          Object.entries(MODE_LABELS).forEach(([mode, label]) => {
            comp.append(mode, label);
          });
        }
        fieldSetter(comp, fieldValue);
        if (component == "buffer") {
          // fix init of placeholder text
          const entry = this[fieldNameByInteralID(`${baseName}-entry`)];
          const placeholder =
            baseName === "show-shutdown-mode"
              ? `${Object.keys(MODE_LABELS).join(",")}  (${Object.values(
                  MODE_LABELS
                ).join(", ")})`
              : entry.get_placeholder_text();
          entry.set_placeholder_text(fieldValue === "" ? placeholder : "");
          const changedId = entry.connect("changed", () => {
            entry.set_placeholder_text(placeholder);
            entry.disconnect(changedId);
          });
          const destroyId = entry.connect("destroy", () => {
            entry.disconnect(changedId);
            entry.disconnect(destroyId);
          });
        }
        let lastActivity = { type: "internal", time: 0 };
        const maybeUpdate = (type, update) => {
          const time = GLib.get_monotonic_time();
          if (lastActivity.type == type || time > lastActivity.time + 100000) {
            lastActivity = { type, time };
            update();
          }
        };
        const handlerId = comp.connect(signal, (w) => {
          maybeUpdate("internal", () => {
            const val = fieldGetter(w);
            settingsSetter(settingsName, val);
          });
        });
        // update ui if values change externally
        const settingsHandlerId = settings.connect(
          "changed::" + settingsName,
          () => {
            maybeUpdate("external", () => {
              const val = settingsGetter(settingsName);
              if (val !== fieldGetter(comp)) {
                fieldSetter(comp, val);
              }
            });
          }
        );
        this.handlers.push([comp, handlerId]);
        this.settingsHandlerIds.push(settingsHandlerId);
      };

      Object.entries(templateComponents).forEach(([k, v]) => {
        connect_comp(k, v);
      });

      // install log text buffer updates
      const logTextBuffer =
        this[fieldNameByInteralID("install-log-text-buffer")];
      const scrollAdj =
        this[fieldNameByInteralID("installer-scrollbar-adjustment")];
      const errorTag = new Gtk.TextTag({ foreground: "red" });
      const successTag = new Gtk.TextTag({ foreground: "green" });
      logTextBuffer.get_tag_table().add(errorTag);
      logTextBuffer.get_tag_table().add(successTag);
      const updateText = () => {
        const text = settings.get_string("install-log-text-value");
        logTextBuffer.set_text(text, -1);
        for (const match of text.matchAll(/^# .+?$/gms)) {
          logTextBuffer.apply_tag(
            errorTag,
            logTextBuffer.get_iter_at_offset(match.index),
            logTextBuffer.get_iter_at_offset(match.index + match[0].length)
          );
        }
        for (const match of text.matchAll(/^ success.*?$/gims)) {
          logTextBuffer.apply_tag(
            successTag,
            logTextBuffer.get_iter_at_offset(match.index),
            logTextBuffer.get_iter_at_offset(match.index + match[0].length)
          );
        }
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          scrollAdj.set_value(1000000);
          return GLib.SOURCE_REMOVE;
        });
      };

      const settingsHandlerId = settings.connect(
        "changed::install-log-text-value",
        updateText
      );
      this.settingsHandlerIds.push(settingsHandlerId);

      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        updateText();
        // show hint if rpm-ostree is installed
        this[fieldNameByInteralID("rpm-ostree-hint-label")].visible =
          GLib.find_program_in_path("rpm-ostree") !== null;
        return GLib.SOURCE_REMOVE;
      });
    }

    destroy() {
      logTextBuffer = null;
      this.handlers.forEach(([comp, handlerId]) => {
        comp.disconnect(handlerId);
      });
      this.settingsHandlerIds.forEach((handlerId) => {
        settings.disconnect(handlerId);
      });
      super.destroy();
    }
  }
);

function init_mode_labels() {
  return {
    suspend: _("Suspend"),
    poweroff: _("Power Off"),
    reboot: _("Restart"),
  };
}

function buildPrefsWidget() {
  MODE_LABELS = init_mode_labels();

  let widget = new ShutdownTimerPrefsWidget();
  if (Gtk.get_major_version() < 4) {
    if (widget.show_all) {
      widget.show_all();
    } else {
      widget.show();
    }
  }

  return widget;
}
