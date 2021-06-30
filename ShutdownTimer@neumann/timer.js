/**
    AUTHOR: Daniel Neumann
**/

const { GLib, Gio } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const RootMode = Extension.imports.rootmode;

/* TIMER */
var Timer = class {
    
    constructor(callbackAction, tick) {
        this._timerMaxSeconds = 0;
        this._timerCancel = null;
        this._callbackAction = callbackAction;
        this._tick = tick;
        this.deadline = -1;
    }


    adjustTo(info) {
        if (info.scheduled) {
            this.startTimer(info);
        } else {
            this.stopTimer();
        }
    }
    
    startTimer(info) {
        if (info.deadline !== this.deadline) {
            // updater for shutdown task
            this.stopProcTimer();
            this.deadline = info.deadline;

            const secs = info.secondsLeft;
            if (secs > 0) {
                log('Started timer: ' + info.label);
                this._timerCancel = new Gio.Cancellable();
                RootMode.execCheck(['sleep', `${secs}`], this._timerCancel, false)
                    .then(() => {
                        this._callbackAction();
                    })
                    .catch(() => {
                        log('Stopped timer: ' + info.label);
                    });

            } else {
                this._callbackAction();
            }
        }
        if (this._timerId === null) {
            // ticks for gui
            this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
                this._tick();
                if (this.deadline > GLib.DateTime.new_now_utc().to_unix()) {
                    return GLib.SOURCE_CONTINUE;
                }
                this._timerId = null;
                return GLib.SOURCE_REMOVE;
            });
            this._tick();
        }
    }

    stopProcTimer() {
        if (this._timerCancel !== null) {
            this._timerCancel.cancel();
        }
        this._timerCancel = null;
    }

    stopTimer() {
        this.deadline = -1;
        this.stopProcTimer();
        this.stopGLibTimer();
    }

    stopGLibTimer() {
        if (this._timerId !== null) {
            GLib.Source.remove(this._timerId);
        }
        this._timerId = null;
    }

};

