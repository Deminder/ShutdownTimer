/**
	AUTHOR: Daniel Neumann
**/

const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;

/* TIMER */
const Timer = new Lang.Class({
	Name: 'Timer',
	
	timerValue: 0,
	_timerValue: 0,
	_timerId: null,
	_startTime: 0,
	_powerOff: null,
	_menuLabel: null,
	
	_init: function(timerValue, powerOffFunction) {
		this.timerValue = timerValue;
		this._powerOff = powerOffFunction;
	},
	
	setMenuLabel: function(label) {
		this._menuLabel = label;
	},
	
	startTimer: function() {
		if (!this._timerId) {
			this._timerValue = this.timerValue;
			this._startTime = GLib.get_monotonic_time();
			this._timerId = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._timerCallback));
			this._menuLabel.text = this._timerValue.toString()+' min till shutdown';
		}
	},
	
	stopTimer: function() {
		Mainloop.source_remove(this._timerId);
		this._timerId = null;
	},

	_timerCallback: function() {
		let currentTime = GLib.get_monotonic_time();
		let secondsElapsed = Math.floor((currentTime - this._startTime) / 1000000);
		
		secondsLeft = (this._timerValue*60) - secondsElapsed;
		if (this._menuLabel && (secondsLeft%60 == 0)) {
			this._menuLabel.text = Math.floor(secondsLeft/60).toString()+' min till shutdown';
		}
		if (secondsLeft > 0) {
			return true;
		}
		
		this._powerOff();
		return false;
	}

});

