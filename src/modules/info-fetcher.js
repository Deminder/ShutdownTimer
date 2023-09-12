// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import { throttleTimeout, logDebug, readFileAsync } from './util.js';

export class InfoFetcher extends Signals.EventEmitter {
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
    return readFileAsync(path, this._cancellable);
  }

  async _isWakeInfoLocal() {
    const content = await this._readFile('/etc/adjtime').catch(() => '');
    return content.trim().toLowerCase().endsWith('local');
  }

  async _fetchWakeInfo(rtc) {
    const content = await this._readFile(
      `/sys/class/rtc/${rtc}/wakealarm`
    ).catch(() => '');
    let timestamp = content !== '' ? parseInt(content) : -1;
    if (timestamp > -1 && (await this._isWakeInfoLocal())) {
      const dt = GLib.DateTime.new_from_unix_local(timestamp);
      timestamp = dt.to_unix() - dt.get_utc_offset() / 1000000;
      dt.unref();
    }
    return { deadline: timestamp };
  }

  async _fetchShutdownInfo() {
    const content = await this._readFile(
      '/run/systemd/shutdown/scheduled'
    ).catch(() => '');
    if (content === '') {
      return { deadline: -1 };
    }
    // content: schedule unix-timestamp (micro-seconds), warn-all, shutdown-mode
    const [usec, _, mode] = content.split('\n').map(l => l.split('=')[1]);
    return {
      mode,
      deadline: parseInt(usec) / 1000000,
    };
  }

  get shutdownInfo() {
    return this._shutdownInfo;
  }

  get wakeInfo() {
    return this._wakeInfo;
  }

  destroy() {
    this.disconnectAll();
    this._refreshCancel();
    this._clearInterval();
    if (this._cancellable !== null) {
      this._cancellable.cancel();
      this._cancellable = null;
    }
  }
}
