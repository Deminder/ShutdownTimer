/**
	AUTHOR: Daniel Neumann
**/

const { GLib, GObject, Gtk } = imports.gi;

const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

var settings;
var MODE_LABELS = {suspend: _("Suspend"), poweroff: _("Power Off"), reboot: _("Restart")};

function init() {
    Convenience.initTranslations();
    settings = Convenience.getSettings();
}

const templateComponents = {
    'max-timer' : 'adjustment',
    'slider' : 'adjustment',
    'show-settings': 'switch',
    'root-mode': 'switch',
    'show-shutdown-mode': 'buffer',
    'check-command': 'buffer',
    'enable-check-command': 'switch',
    'shutdown-mode': 'combo',
};


const templateFile = Me.dir
    .get_child('ui')
    .get_child('pref-window' + (Gtk.get_major_version() < 4 ? '' : '-gtk4') + '.ui')
    .get_uri();

const ShutdownTimerPrefsWidget = GObject.registerClass({
    Name: 'ShutdownTimer.Prefs.Widget',
    GTypeName: 'ShutdownTimerPrefsWidget',
    Template:  templateFile, 
    InternalChildren: Object.entries(templateComponents)
    // entries only required for placeholder fix
    .flatMap(([b,c]) => c === 'buffer' ? [[b, 'entry'], [b,c]] : [[b,c]])
    .map((n) => n.join('-')),
}, class ShutdownTimerPrefsWidget extends Gtk.Grid {

    _init(params = {}) {
        super._init(params);
        this.handlers = [];

        const connectFuncs = {
            adjustment: [
                (v) => v.get_value(),
                (v, s) => v.set_value(s),
                (sn) => settings.get_int(sn),
                (sn, v) => settings.set_int(sn, v),
                'value-changed'
            ],
            switch: [
                v => v.get_active(),
                (v, s) => v.set_active(s),
                sn => settings.get_boolean(sn),
                (sn, v) => settings.set_boolean(sn, v),
                'notify::active'
                ], 
            buffer: [
                v => v.get_text(),
                (v, s) => v.set_text(s, -1),
                sn => settings.get_string(sn),
                (sn, v) => settings.set_string(sn, v),
                'notify::text'
            ],
            combo: [
                v => v.get_active_id(),
                (v, s) => v.set_active_id(s),
                sn => settings.get_string(sn),
                (sn, v) => settings.set_string(sn, v),
                'changed'
            ]
        };

        const fieldNameByInteralID = (internalID) => {
            const fieldName = '_' + internalID.replaceAll('-', '_');
            if (!(fieldName in this) || this[fieldName] === null) {
                throw new Error(`Template Error '${templateFile}': '${fieldName}' not found in ${JSON.stringify(this)}`);
            }
            return fieldName;
        };

        const connect_comp = (baseName, component) => {
            const [fieldGetter, fieldSetter, settingsGetter, settingsSetter, signal] = connectFuncs[component];
            const settingsName = `${baseName}-value`;
            const fieldName = fieldNameByInteralID(`${baseName}-${component}`);
            const fieldValue= settingsGetter(settingsName);
            const comp = this[fieldName];
            if (baseName === 'shutdown-mode') {
                // update combo box entries
                comp.remove_all();
                Object.entries(MODE_LABELS).forEach(([mode, label]) => {
                    comp.append(mode, label);
                });
            }
            fieldSetter(comp, fieldValue);
            if (comp == 'buffer') {
                // fix init of placeholder text
                const entry = this[fieldNameByInteralID(`${baseName}-entry`)];
                const placeholder = baseName === 'show-shutdown-mode' ? 
                    `${Object.keys(MODE_LABELS).join(',')}  (${Object.values(MODE_LABELS).join(', ')})` :
                    entry.get_placeholder_text();
                entry.set_placeholder_text(fieldValue === '' ? placeholder : '');
                const changedId = entry.connect('changed', () => {
                    entry.set_placeholder_text(placeholder);
                    entry.disconnect(changedId);
                });
                const destroyId  = entry.connect('destroy', () => {
                    entry.disconnect(changedId);
                    entry.disconnect(destroyId);
                });
            }
            let lastActivity = {type:'internal', time:0};
            const maybeUpdate = (type, update) => {
                const time = GLib.get_monotonic_time();
                if (lastActivity.type == type || time > lastActivity.time + 100000) {
                    lastActivity = {type, time};
                    update();
                }
            };
            const handlerId = comp.connect(signal, (w) => {
                maybeUpdate('internal', () => {
                    const val = fieldGetter(w);
                    settingsSetter(settingsName, val);
                });
            });
            // update ui if values change externally 
            const settingsHandlerId = settings.connect('changed::' + settingsName, () => {
                maybeUpdate('internal', () => {
                    const val = settingsGetter(settingsName);
                    if (val !== fieldGetter(comp)) {
                        fieldSetter(comp, val);
                    }
                });
            });
            this.handlers.push([comp, handlerId, () => {
                settings.disconnect(settingsHandlerId);
            }]);
        };

        Object.entries(templateComponents).forEach(([k, v]) => {
            connect_comp(k, v);
        });
    }

    destroy() {
        this.handlers.forEach(([comp, handlerId, onDisconnect]) => {
            comp.disconnect(handlerId);
            onDisconnect();
        });
        this.handlers = [];
        super.destroy();
    }

});

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
