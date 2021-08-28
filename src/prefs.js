/**
 * Extension preferences GUI
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported WAKE_MODES, MODES, logInstall, init, buildPrefsWidget */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { Install, Convenience } = Me.imports.lib;
const logDebug = Convenience.logDebug;

const { GLib, GObject, Gtk } = imports.gi;

const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

let settings;
var MODES = ['suspend', 'poweroff', 'reboot'];
var WAKE_MODES = ['wake', 'no-wake'];

function logInstall(message) {
  settings.set_string(
    'install-log-text-value',
    settings.get_string('install-log-text-value') + message + '\n'
  );
}

function modeLabel(mode) {
  return {
    suspend: _('Suspend'),
    poweroff: _('Power Off'),
    reboot: _('Restart'),
    wake: _('Wake after'),
    'no-wake': _('No Wake'),
  }[mode];
}

function init() {
  ExtensionUtils.initTranslations();
  imports.gettext.textdomain(Me.metadata['gettext-domain']);
  settings = ExtensionUtils.getSettings();
}

const templateComponents = {
  'shutdown-max-timer': 'adjustment',
  'shutdown-slider': 'adjustment',
  'non-linear-shutdown-slider': 'decimal',
  'show-settings': 'switch',
  'root-mode': 'switch',
  'show-shutdown-mode': 'buffer',
  'show-shutdown-slider': 'switch',
  'show-textboxes': 'switch',
  'check-command': 'buffer',
  'enable-check-command': 'switch',
  'shutdown-mode': 'combo',
  'auto-wake': 'switch',
  'wake-max-timer': 'adjustment',
  'wake-slider': 'adjustment',
  'non-linear-wake-slider': 'decimal',
  'show-wake-slider': 'switch',
  'show-wake-items': 'switch',
};

const templateFile = Me.dir
  .get_child('ui')
  .get_child('prefs' + (Gtk.get_major_version() < 4 ? '' : '-gtk4') + '.ui')
  .get_uri();

const ShutdownTimerPrefsWidget = GObject.registerClass(
  {
    Name: 'ShutdownTimer.Prefs.Widget',
    GTypeName: 'ShutdownTimerPrefsWidget',
    Template: templateFile,
    InternalChildren: Object.entries(templateComponents)
      // entries only required for placeholder fix
      .flatMap(([b, c]) =>
        c === 'buffer'
          ? [
            [b, 'entry'],
            [b, c],
          ]
          : [[b, c]]
      )
      .map(n => n.join('-'))
      .concat(
        'install-log-text-buffer',
        'installer-scrollbar-adjustment',
        'install-policy-switch'
      ),
  },
  class ShutdownTimerPrefsWidget extends Gtk.Grid {
    _init(params = {}) {
      super._init(params);
      this.handlers = [];
      this.settingsHandlerIds = [];
      this.idleSourceIds = {};

      const connectFuncs = {
        adjustment: [
          v => v.get_value(),
          (v, s) => v.set_value(s),
          sn => settings.get_int(sn),
          (sn, v) => settings.set_int(sn, v),
          'value-changed',
        ],
        decimal: [
          v => v.get_value(),
          (v, s) => v.set_value(s),
          sn => Number.parseFloat(settings.get_string(sn)),
          (sn, v) => settings.set_string(sn, v.toFixed(3)),
          'value-changed',
        ],
        switch: [
          v => v.get_active(),
          (v, s) => v.set_active(s),
          sn => settings.get_boolean(sn),
          (sn, v) => settings.set_boolean(sn, v),
          'notify::active',
        ],
        buffer: [
          v => v.get_text(),
          (v, s) => v.set_text(s, -1),
          sn => settings.get_string(sn),
          (sn, v) => settings.set_string(sn, v),
          'notify::text',
        ],
        combo: [
          v => v.get_active_id(),
          (v, s) => v.set_active_id(s),
          sn => settings.get_string(sn),
          (sn, v) => settings.set_string(sn, v),
          'changed',
        ],
      };

      const fieldNameByInteralID = internalID => {
        const fieldName = '_' + internalID.replaceAll('-', '_');
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
        if (baseName === 'shutdown-mode') {
          // update combo box entries
          comp.remove_all();
          MODES.forEach(mode => {
            comp.append(mode, modeLabel(mode));
          });
        }
        fieldSetter(comp, fieldValue);
        if (component === 'buffer') {
          // fix init of placeholder text
          const entry = this[fieldNameByInteralID(`${baseName}-entry`)];
          const placeholder =
            baseName === 'show-shutdown-mode'
              ? `${MODES.map(modeLabel).join(',')}  (${MODES.join(', ')})`
              : entry.get_placeholder_text();
          entry.set_placeholder_text(fieldValue === '' ? placeholder : '');
          const changedId = entry.connect('changed', () => {
            entry.set_placeholder_text(placeholder);
            entry.disconnect(changedId);
          });
          const destroyId = entry.connect('destroy', () => {
            entry.disconnect(changedId);
            entry.disconnect(destroyId);
          });
        }
        let lastActivity = { type: 'internal', time: 0 };
        const maybeUpdate = (type, update) => {
          const time = GLib.get_monotonic_time();
          if (lastActivity.type === type || time > lastActivity.time + 100000) {
            lastActivity = { type, time };
            update();
          }
        };
        const handlerId = comp.connect(signal, w => {
          maybeUpdate('internal', () => {
            const val = fieldGetter(w);
            settingsSetter(settingsName, val);
          });
        });
        // update ui if values change externally
        const settingsHandlerId = settings.connect(
          'changed::' + settingsName,
          () => {
            maybeUpdate('external', () => {
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
        this[fieldNameByInteralID('install-log-text-buffer')];
      const scrollAdj =
        this[fieldNameByInteralID('installer-scrollbar-adjustment')];
      const errorTag = new Gtk.TextTag({ foreground: 'red' });
      const successTag = new Gtk.TextTag({ foreground: 'green' });
      logTextBuffer.get_tag_table().add(errorTag);
      logTextBuffer.get_tag_table().add(successTag);
      const appendLogLine = line => {
        line = ['[', '#'].includes(line[0]) ? line : ' ' + line;
        logTextBuffer.insert(logTextBuffer.get_end_iter(), line + '\n', -1);
        const lastLineIndex = logTextBuffer.get_line_count() - 1;
        const lineIter = lineIndex => {
          const res = logTextBuffer.get_iter_at_line(lineIndex);
          if (Gtk.get_major_version() < 4) {
            return res;
          }
          const [ok, iter] = res;
          if (!ok) {
            throw new Error(`Line ${lineIndex} not found!`);
          }
          return iter;
        };
        const applyTag = tag => {
          logTextBuffer.apply_tag(
            tag,
            lineIter(lastLineIndex - 1),
            lineIter(lastLineIndex)
          );
        };
        if (line.startsWith('# ')) {
          applyTag(errorTag);
        } else if (line.endsWith('🟢')) {
          applyTag(successTag);
        }
        this.guiIdle()
          .then(() => {
            scrollAdj.set_value(1000000);
          })
          .catch(() => {});
      };

      const installSwitch = this[fieldNameByInteralID('install-policy-switch')];
      installSwitch.set_active(Install.checkInstalled());
      const switchHandlerId = installSwitch.connect('notify::active', () =>
        Install.installAction(
          installSwitch.get_active() ? 'install' : 'uninstall',
          message =>
            this.guiIdle()
              .then(() => message.split('\n').forEach(appendLogLine))
              .catch(err => {
                logDebug(`${err}...\nMissed message: ${message}`);
              })
        )
      );
      this.handlers.push([installSwitch, switchHandlerId]);

      this.guiIdle().then(() => {
        // clear log
        logTextBuffer.set_text('', -1);
      });

      const destroyId = this.connect('destroy', () => {
        this._releaseEverything();
        this.disconnect(destroyId);
      });
    }

    guiIdle() {
      return new Promise((resolve, reject) => {
        try {
          const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            resolve();
            delete this.idleSourceIds[sourceId];
            return GLib.SOURCE_REMOVE;
          });
          this.idleSourceIds[sourceId] = 1;
        } catch (err) {
          reject(err);
        }
      });
    }

    _releaseEverything() {
      Object.keys(this.idleSourceIds).forEach(sourceId => {
        GLib.Source.remove(sourceId);
      });
      this.handlers.forEach(([comp, handlerId]) => {
        comp.disconnect(handlerId);
      });
      this.settingsHandlerIds.forEach(handlerId => {
        settings.disconnect(handlerId);
      });
      Install.reset();
    }
  }
);

function buildPrefsWidget() {
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
