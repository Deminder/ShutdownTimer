/**
	AUTHOR: Daniel Neumann
**/

const { GObject, Gtk } = imports.gi;
const Lang = imports.lang;

const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

var settings;

function init() {
    Convenience.initTranslations();
    settings = Convenience.getSettings();
}

const templateComponents = {
    'max-timer' : 'spinbutton',
    'slider' : 'spinbutton',
    'show-settings': 'switch',
    'root-mode': 'switch',
    'use-suspend': 'switch',
    'check-command': 'buffer',
    'enable-check-command': 'switch',
};
const Config = imports.misc.config;
const ShellVersion = parseFloat(Config.PACKAGE_VERSION);

const templateFile = Me.dir.get_child('templates').get_child('pref-window' + (ShellVersion < 40 ? '' : '-gtk4.ui')).get_path();

const ShutdownTimerPrefsWidget = GObject.registerClass({
    Name: 'ShutdownTimer.Prefs.Widget',
    GTypeName: 'ShutdownTimerPrefsWidget',
    Template: 'file://' + templateFile , 
    InternalChildren: Object.entries(templateComponents).map((n) => n.join('-')),
}, class ShutdownTimerPrefsWidget extends Gtk.Grid {

    _init(params = {}) {
        super._init(params);

        const connectFuncs = {
            spinbutton: [
                (v) => v.get_value_as_int(),
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
            ]
        };

        const connect_comp = (baseName, component) => {
            const [fieldGetter, fieldSetter, settingsGetter, settingsSetter, signal] = connectFuncs[component];
            const internalID = `${baseName}-${component}`;
            const settingsName = `${baseName}-value`;
            const fieldName = '_' + internalID.replaceAll('-', '_');
            if (!(fieldName in this) || this[fieldName] === null) {
                throw new Error(`Template Error '${templateFile}': '${fieldName}' not found in ${JSON.stringify(this)}`);
            }
            fieldSetter(this[fieldName], settingsGetter(settingsName));
            this[fieldName].connect(signal, (w) => {
                settingsSetter(settingsName, fieldGetter(w));
                log(`Signal ${signal}: ${fieldName} -> ${settingsName}`);
            });
        };

        Object.entries(templateComponents).forEach(([k, v]) => {
            connect_comp(k, v);
        });
    }

});

function buildPrefsWidget() {
    let widget = new ShutdownTimerPrefsWidget();
    if (widget.show_all) {
        widget.show_all();
    } else {
        widget.show();
    }

    return widget;
}
