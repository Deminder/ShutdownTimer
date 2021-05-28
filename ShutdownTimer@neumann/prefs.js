/**
	AUTHOR: Daniel Neumann
**/

const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

let settings;

function init() {
    Convenience.initTranslations();
    settings = Convenience.getSettings();
}

const ShutdownTimerPrefsWidget = new GObject.Class({
    Name: 'ShutdownTimer.Prefs.Widget',
    GTypeName: 'ShutdownTimerPrefsWidget',
    Extends: Gtk.Grid,

    _init: function(params) {
        this.parent(params);
        this.set_margin_start(24);
        this.set_margin_top(24);
        this.set_margin_bottom(24);
        this.row_spacing = this.column_spacing = 6;
        this.set_orientation(Gtk.Orientation.VERTICAL);

        this.attach(new Gtk.Label({ label: '<b>' + _("Maximum timer value (in minutes)") + '</b>',
                        use_markup: true,
                        halign: Gtk.Align.START }), 0, 0, 1, 1);
                                    
        let entry = new Gtk.SpinButton({halign:Gtk.Align.START});
        let maxTimerValueDefault = settings.get_int('max-timer-value');
        entry.set_increments(1, 1);
        entry.set_range(1, 500);
        entry.connect('value-changed', Lang.bind(this, function(button){
            let s = button.get_value_as_int();
            settings.set_int('max-timer-value', s);
        }));
        entry.set_value(maxTimerValueDefault);
        this.attach(entry, 0, 1, 1, 1);
        
        this.attach(new Gtk.Label({ label: '', halign: Gtk.Align.START }), 0, 2, 1, 1);
        
        this.attach(new Gtk.Label({ label: '<b>' + _("Slider position (in % from 0 to 100)") + '</b>',
                        use_markup: true,
                        halign: Gtk.Align.START }), 0, 3, 1, 1);
                                 
        let sliderEntry = new Gtk.SpinButton({halign:Gtk.Align.START});
        let sliderDefault = settings.get_int('slider-value');
        sliderEntry.set_increments(1, 1);
        sliderEntry.set_range(0, 100);
        sliderEntry.connect('value-changed', Lang.bind(this, function(button){
            let s = button.get_value_as_int();
            settings.set_int('slider-value', s);
        }));
        sliderEntry.set_value(sliderDefault);
        this.attach(sliderEntry, 0, 4, 1, 1);
        

        this.attach(new Gtk.Label({ label: '', halign: Gtk.Align.START }), 0, 5, 1, 1);

        this.attach(new Gtk.Label({ label: '<b>' + _("Show settings button") + '</b>',
                        use_markup: true,
                        halign: Gtk.Align.START }), 0, 6, 1, 1);
        let settingsButtonValue = settings.get_boolean('show-settings-value');
        let switchMenuItemSettingsButton = new Gtk.Switch({halign:Gtk.Align.START});
        switchMenuItemSettingsButton.connect('notify::active', Lang.bind(this, function(check){ 
            settings.set_boolean('show-settings-value', check.get_active());
        }));
        switchMenuItemSettingsButton.set_active(settingsButtonValue);
        this.attach(switchMenuItemSettingsButton, 0, 7, 1, 1);

        this.attach(new Gtk.Label({ label: '', halign: Gtk.Align.START }), 0, 8, 1, 1);
        
        this.attach(new Gtk.Label({ label: '<b>' + _("Root mode (uses 'pkexec shutdown' command,\nno interruption of timer, but needs root password)") + '</b>',
                        use_markup: true,
                        halign: Gtk.Align.START }), 0, 9, 1, 1);
        let rootMode = settings.get_boolean('root-mode-value');
        let switchMenuItemRootMode = new Gtk.Switch({halign:Gtk.Align.START});
        switchMenuItemRootMode.connect('notify::active', Lang.bind(this, function(check){ 
            settings.set_boolean('root-mode-value', check.get_active());
        }));
        switchMenuItemRootMode.set_active(rootMode);
        this.attach(switchMenuItemRootMode, 0, 10, 1, 1);

        this.attach(new Gtk.Label({ label: '', halign: Gtk.Align.START }), 0, 11, 1, 1);

        this.attach(new Gtk.Label({ label: '<b>' + _("Use suspend") + '</b>',
                        use_markup: true,
                        halign: Gtk.Align.START }), 0, 12, 1, 1);
        let useSuspendValue = settings.get_boolean('use-suspend-value');
        let switchMenuItemUseSuspend = new Gtk.Switch({halign:Gtk.Align.START});
        switchMenuItemUseSuspend.connect('notify::active', Lang.bind(this, function(check){ 
            settings.set_boolean('use-suspend-value', check.get_active());
        }));
        switchMenuItemUseSuspend.set_active(useSuspendValue);
        this.attach(switchMenuItemUseSuspend, 0, 13, 1, 1);
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
