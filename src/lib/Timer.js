/**
 * Timer module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported Timer */
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { RootMode, ScheduleInfo } = Me.imports.lib;
const logDebug = Me.imports.lib.Convenience.logDebug;

const { GLib, Gio } = imports.gi;

/* TIMER */
var Timer = class {
  constructor(callbackAction, initialMode = 'shutdown') {
    this._timerMaxSeconds = 0;
    this._timerCancel = null;
    this._callbackAction = callbackAction;
    this._tick = null;
    this._timerId = null;
    this.info = new ScheduleInfo.ScheduleInfo({ mode: initialMode });
  }

  setTickCallback(tick) {
    this._tick = tick;
  }

  adjustTo(info) {
    const newDeadline = info.deadline !== this.info.deadline;
    this.info = info;
    if (info.scheduled) {
      this.startTimer(newDeadline);
    } else {
      this.stopTimer();
    }
  }

  startTimer(newDeadline) {
    if (newDeadline) {
      // updater for shutdown task
      this.stopProcTimer();

      const secs = this.info.secondsLeft;
      if (secs > 0) {
        logDebug(
          `Started timer: ${this.info.minutes}min remaining (deadline: ${this.info.deadline})`
        );
        this._timerCancel = new Gio.Cancellable();
        RootMode.execCheck(['sleep', `${secs}`], this._timerCancel, false)
          .then(() => {
            this._callbackAction(this.info.mode);
          })
          .catch(() => {
            logDebug(
              `Stopped timer: ${this.info.minutes}min remaining (deadline: ${this.info.deadline})`
            );
          });
      } else {
        this._callbackAction(this.info.mode);
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
