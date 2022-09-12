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

const { Gio } = imports.gi;

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
      if (newDeadline) {
        // update proc process for new deadline
        this.startProcTimer();
      }
      this.startForegroundTick();
      logDebug(
        `Started timer: ${this.info.minutes}min remaining (deadline: ${this.info.deadline})`
      );
    } else {
      this.stopTimer();
      logDebug(
        `Stopped timer: ${this.info.minutes}min remaining (deadline: ${this.info.deadline})`
      );
    }
  }

  stopTimer() {
    this.stopProcTimer();
    this.stopForeground();
  }

  _maybeRunTimerAction() {
    if (this._timerCancel !== null) {
      // ensure timer action is only run once
      logDebug(`Running '${this.info.mode}' timer action...`);
      this._callbackAction(this.info.mode);
    }
  }

  async startProcTimer() {
    // secondary timer witch calls a sleep process as timer
    this.stopProcTimer();

    const secs = this.info.secondsLeft;
    this._timerCancel = new Gio.Cancellable();
    try {
      if (secs > 0) {
        await RootMode.execCheck(
          ['sleep', `${secs}`],
          this._timerCancel,
          false
        );
      }
      this._maybeRunTimerAction();
    } catch {
    } finally {
      this._timerCancel = null;
    }
  }

  stopProcTimer() {
    if (this._timerCancel !== null) {
      this._timerCancel.cancel();
    }
    this._timerCancel = null;
  }

  _maybeTick() {
    if (this._tick !== null) {
      this._tick();
    }
  }

  startForegroundTick() {
    if (this._timerId === null) {
      // primary timer which updates ticks every second
      this._timerId = setInterval(() => {
        this._maybeTick();
        if (!this.info.scheduled || this.info.secondsLeft < 0) {
          // timer completed
          this._maybeRunTimerAction();
          this.stopTimer();
        }
      }, 1000);
      this._maybeTick();
    }
  }

  stopForeground() {
    if (this._timerId) {
      clearInterval(this._timerId);
    }
    this._timerId = null;
  }
};
