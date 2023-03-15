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
const { EventEmitter } = imports.misc.signals;
const logDebug = Me.imports.lib.Convenience.logDebug;

const { GObject, Gio } = imports.gi;

var Timer = class extends EventEmitter {
  constructor() {
    super();
    this._cancellable = null;
    this.stopTimer();
  }

  adjustTo(info) {
    const newDeadline = info.deadline !== this.info.deadline;
    this.info = info;
    if (newDeadline) {
      // Restart timer for new deadline
      if (this._cancellable !== null) this._cancellable.cancel();
      else this.updateTimer();
    }
  }

  stopTimer() {
    if (this._cancellable !== null) this._cancellable.cancel();
    this.info = new ScheduleInfo.ScheduleInfo({ mode: 'shutdown' });
  }

  async updateTimer() {
    if (this._cancellable !== null) return;
    if (this.info.scheduled) {
      const secs = this.info.secondsLeft;
      if (secs > 0) {
        logDebug(
          `Started timer: ${this.info.minutes}min remaining (deadline: ${this.info.deadline})`
        );
        this._cancellable = new Gio.Cancellable();
        try {
          await RootMode.execCheck(
            ['sleep', `${secs}`],
            this._cancellable,
            false
          );
        } catch {}
        this._cancellable = null;
        await this.updateTimer();
      } else {
        this.emit('action');
      }
    } else {
      logDebug(
        `Stopped timer: ${this.info.minutes}min remaining (deadline: ${this.info.deadline})`
      );
    }
  }
};
