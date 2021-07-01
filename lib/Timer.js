const Me = imports.misc.extensionUtils.getCurrentExtension();
const RootMode = Me.imports.lib.RootMode;

const { GLib, Gio } = imports.gi;

/* TIMER */
var Timer = class {
    
    constructor(callbackAction, tick) {
        this._timerMaxSeconds = 0;
        this._timerCancel = null;
        this._callbackAction = callbackAction;
        this._tick = tick;
        this.deadline = -1;
    }


    adjustTo(info, guiReady) {
        if (info.scheduled) {
            this.startTimer(info, guiReady);
        } else {
            this.stopTimer();
        }
    }
    
    startTimer(info, guiReady) {
        if (info.deadline !== this.deadline) {
            // updater for shutdown task
            this.stopProcTimer();
            this.deadline = info.deadline;

            const secs = info.secondsLeft;
            if (secs > 0) {
                log(`Started timer: ${info.minutes}min remaining (deadline: ${info.deadline})`);
                this._timerCancel = new Gio.Cancellable();
                RootMode.execCheck(['sleep', `${secs}`], this._timerCancel, false)
                    .then(() => {
                        this._callbackAction();
                    })
                    .catch(() => {
                        log(`Stopped timer: ${info.minutes}min remaining (deadline: ${info.deadline})`);
                    });

            } else {
                this._callbackAction();
            }
        }
        if (this._timerId === null && guiReady) {
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

