/**
    AUTHOR: Daniel Neumann
**/

const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const Util = imports.misc.util;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

/* TIMER */
var Timer = new Lang.Class({
    Name: 'Timer',
    
    _timerValue: 0,
    _timerId: null,
    _startTime: 0,
    _callbackAction: null,
    _menuLabel: null,
    _settings: null,
    
    _init: function(callbackAction) {
        this._callbackAction = callbackAction;
        this._settings = Convenience.getSettings();
    },
    
    setMenuLabel: function(label) {
        this._menuLabel = label;
    },
    
    startTimer: function() {
        if (!this._timerId) {
            let sliderValue = this._settings.get_int('slider-value') / 100.0;
            this._timerValue = Math.floor(sliderValue * this._settings.get_int('max-timer-value'));
            
            if(this._settings.get_boolean('use-suspend-value') || !this._settings.get_boolean('root-mode-value')) {
                this._startTime = GLib.get_monotonic_time();
                this._timerId = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._timerCallback));
                this._menuLabel.text = this._timerValue.toString() + ' ' + _("min till shutdown");
            } else {
                let pkexec_path = GLib.find_program_in_path('pkexec');
                let shutdown_path = GLib.find_program_in_path('shutdown');
                Util.spawnCommandLine(pkexec_path + " " + shutdown_path + " -h " + this._timerValue);
            }
        }
    },
    
    stopTimer: function() {
        Mainloop.source_remove(this._timerId);
        this._timerId = null;
    },

    _timerCallback: function() {
        let currentTime = GLib.get_monotonic_time();
        let secondsElapsed = Math.floor((currentTime - this._startTime) / 1000000);
        
        let secondsLeft = (this._timerValue*60) - secondsElapsed;
        if (this._menuLabel && (secondsLeft%60 == 0)) {
            this._menuLabel.text = Math.floor(secondsLeft/60).toString()+' '+_("min till shutdown");
        }
        if (secondsLeft > 0) {
            return true;
        }
        
        this._callbackAction();
        return false;
    }

});

