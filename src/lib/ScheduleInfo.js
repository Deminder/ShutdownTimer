// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/* exported ScheduleInfo */
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { durationString } = Me.imports.lib.Convenience;

const { GLib } = imports.gi;

const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const C_ = Gettext.pgettext;

var ScheduleInfo = class {
  constructor({ mode = '?', deadline = -1, external = false }) {
    this._v = { mode, deadline, external };
  }

  copy(vals) {
    return new ScheduleInfo({ ...this._v, ...vals });
  }

  get deadline() {
    return this._v.deadline;
  }

  get external() {
    return this._v.external;
  }

  get mode() {
    return this._v.mode;
  }

  get scheduled() {
    return this.deadline > -1;
  }

  get secondsLeft() {
    return this.deadline - GLib.DateTime.new_now_utc().to_unix();
  }

  get minutes() {
    return Math.floor(this.secondsLeft / 60);
  }

  get modeText() {
    const texts = {
      suspend: _('suspend'),
      poweroff: _('shutdown'),
      reboot: _('reboot'),
      wake: _('wakeup'),
    };
    return this.mode in texts ? texts[this.mode] : texts['poweroff'];
  }

  get label() {
    let label = '';
    if (this.scheduled) {
      label = _('%s until %s').format(
        durationString(this.secondsLeft),
        this.modeText
      );
      if (this.external) {
        label = _('%s (sys)').format(label);
      }
    }
    return label;
  }

  get absoluteTimeString() {
    return GLib.DateTime.new_from_unix_utc(this.deadline)
      .to_local()
      .format(C_('absolute schedule notation', '%a, %T'));
  }

  isMoreUrgendThan(otherInfo) {
    return (
      !otherInfo.scheduled ||
      (this.scheduled &&
        // external deadline is instant, internal deadline has 1 min slack time
        (this.external ? this.deadline : this.deadline + 58) <
          otherInfo.deadline)
    );
  }
};
