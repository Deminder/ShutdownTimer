const Me = imports.misc.extensionUtils.getCurrentExtension();
const RootMode = Me.imports.lib.RootMode;
const logDebug = Me.imports.lib.Convenience.logDebug;

const { GLib, Gio } = imports.gi;

/* TIMER */
var Timer = class {
  constructor(callbackAction, initialMode = "shutdown") {
    this._timerMaxSeconds = 0;
    this._timerCancel = null;
    this._callbackAction = callbackAction;
    this._tick = null;
    this.deadline = -1;
    this._serveMode = initialMode;
  }

  setTickCallback(tick) {
    this._tick = tick;
  }

  adjustTo(info) {
    this._serveMode = info.mode;
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
        logDebug(
          `Started timer: ${info.minutes}min remaining (deadline: ${info.deadline})`
        );
        this._timerCancel = new Gio.Cancellable();
        RootMode.execCheck(["sleep", `${secs}`], this._timerCancel, false)
          .then(() => {
            this._callbackAction(this._serveMode);
          })
          .catch(() => {
            logDebug(
              `Stopped timer: ${info.minutes}min remaining (deadline: ${info.deadline})`
            );
          });
      } else {
        this._callbackAction(this._serveMode);
      }
    }
    if (this._timerId === null && this._tick !== null) {
      // ticks for gui
      this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
        if (this._tick !== null) {
          this._tick();
        } else if (this.deadline > GLib.DateTime.new_now_utc().to_unix()) {
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
