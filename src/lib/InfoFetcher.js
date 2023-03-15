/**
 * InfoFetcher module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported InfoFetcher */

const { Gio, GLib, GObject } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { Convenience } = Me.imports.lib;
const { EventEmitter } = imports.misc.signals;
const { logDebug, throttleTimeout } = Convenience;
const ByteArray = imports.byteArray;

var InfoFetcher = class extends EventEmitter {
  constructor() {
    super();
    this._intervalId = null;
    this._tickPromise = null;
    this._shutdownInfo = {};
    this._wakeInfo = {};
    this._rtc = 'rtc0';
    this._cancellable = new Gio.Cancellable();
    [this.refresh, this._refreshCancel] = throttleTimeout(
      this._refresh.bind(this),
      300
    );
    this.refresh();
  }

  _refresh() {
    this._refreshCancel();
    this._clearInterval();
    logDebug('Extra info refresh...');
    this._intervalId = setInterval(this.tick.bind(this), 5000);
    this.tick();
  }

  _clearInterval() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  tick() {
    if (this._tickPromise === null) {
      this._tickPromise = Promise.all([
        this._fetchShutdownInfo(),
        this._fetchWakeInfo(this._rtc),
      ]).then(([shutdown, wake]) => {
        this._tickPromise = null;
        this._shutdownInfo = shutdown;
        this._wakeInfo = wake;
        this.emit('changed');
      });
    }
  }

  _readFile(path) {
    return new Promise((resolve, reject) => {
      try {
        const file = Gio.File.new_for_path(path);
        file.load_contents_async(this._cancellable, (f, res) => {
          try {
            const [, contents] = f.load_contents_finish(res);
            resolve(ByteArray.toString(contents));
            GLib.free(contents);
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async _isWakeInfoLocal() {
    const content = await this._readFile('/etc/adjtime').catch(() => '');
    return content.trim().toLowerCase().endsWith('local');
  }

  async _fetchWakeInfo(rtc) {
    let content = '';
    try {
      content = await this._readFile(`/sys/class/rtc/${rtc}/wakealarm`);
    } catch {}
    let timestamp = content !== '' ? parseInt(content) : -1;
    if (timestamp > -1 && (await this._isWakeInfoLocal())) {
      const dt = GLib.DateTime.new_from_unix_local(timestamp);
      timestamp = dt.to_unix() - dt.get_utc_offset() / 1000000;
      dt.unref();
    }
    return { deadline: timestamp };
  }

  async _fetchShutdownInfo() {
    try {
      const content = await this._readFile('/run/systemd/shutdown/scheduled');
      // content: schedule unix-timestamp (micro-seconds), warn-all, shutdown-mode
      const [usec, _, mode] = content.split('\n').map(l => l.split('=')[1]);
      return {
        mode,
        deadline: parseInt(usec) / 1000000,
      };
    } catch {
      return { deadline: -1 };
    }
  }

  get shutdownInfo() {
    return this._shutdownInfo;
  }

  get wakeInfo() {
    return this._wakeInfo;
  }

  destroy() {
    this._refreshCancel();
    this._clearInterval();
    if (this._cancellable !== null) {
      this._cancellable.cancel();
      this._cancellable = null;
    }
  }
};
