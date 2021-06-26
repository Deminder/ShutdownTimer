/**
    AUTHOR: Daniel Neumann
**/

const GLib = imports.gi.GLib;

/* TIMER */
var Timer = class {
    
    constructor(callbackAction, secondsLeftCallback) {
        this._timerTotalMinutes = 0;
        this._timerId = null;
        this._startTime = 0;
        this._callbackAction = callbackAction;
        this._secondsLeftCallback = secondsLeftCallback;
    }
    
    
    startTimer(maxTimerMinutes) {
        if (this._timerId === null) {
            this._timerTotalMinutes = maxTimerMinutes;
            this._secondsLeftCallback(maxTimerMinutes*60);

            if (this._timerTotalMinutes > 0) {
                // GLib monotonic time misses ticks if suspended
                // [https://gjs-docs.gnome.org/glib20~2.66.1/glib.get_monotonic_time]
                this._startTime = GLib.DateTime.new_now_utc().to_unix();
                this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 10, () => {
                    let currentTime = GLib.DateTime.new_now_utc().to_unix();
                    let secondsElapsed = currentTime - this._startTime;
                    
                    let secondsLeft = (this._timerTotalMinutes*60) - secondsElapsed;
                    this._secondsLeftCallback(secondsLeft);
                    if (secondsLeft > 0) {
                        return GLib.SOURCE_CONTINUE;
                    }
                    
                    this._callbackAction();
                    this._timerId = null;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._callbackAction();
            }
        }
    }

    stopTimer() {
        if (this._timerId !== null) {
            GLib.Source.remove(this._timerId);
        }
        this._timerId = null;
    }

};

