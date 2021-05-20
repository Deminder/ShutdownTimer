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
        this.set_margin_start(12);
        this.set_margin_top(12);
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
        
        this.attach(new Gtk.Label({ label: '<b>' + _("Root mode (uses 'pkexec shutdown' command,\nno interruption of timer, but needs root password)") + '</b>',
                         use_markup: true,
                         halign: Gtk.Align.START }), 0, 6, 1, 1);
        let rootMode = settings.get_boolean('root-mode-value');
        let switchMenuItem = new Gtk.Switch({halign:Gtk.Align.START});
        switchMenuItem.connect('notify::active', Lang.bind(this, function(check){ 
            settings.set_boolean('root-mode-value', check.get_active());
        }));
        switchMenuItem.set_active(rootMode);
        this.attach(switchMenuItem, 0, 7, 1, 1);
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
