// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import { gettext as _, ngettext as _n, pgettext as C_ } from './translation.js';
import { mapLegacyAction, untilText } from '../dbus-service/action.js';

export class ScheduleInfo {
  constructor({ mode = '?', deadline = -1, external = false }) {
    this._v = { mode: mapLegacyAction(mode), deadline, external };
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

  get label() {
    let label = '';
    if (this.scheduled) {
      label = _('{durationString} until {untiltext}')
        .replace('{durationString}', durationString(this.secondsLeft))
        .replace('{untiltext}', untilText(this.mode));
      if (this.external) {
        label = _('{label} (sys)').replace('{label}', label);
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
}

export function getShutdownScheduleFromSettings(settings) {
  return new ScheduleInfo({
    mode: settings.get_string('shutdown-mode-value'),
    deadline: settings.get_int('shutdown-timestamp-value'),
  });
}

export function getSliderMinutesFromSettings(settings, prefix) {
  const sliderValue = settings.get_double(`${prefix}-slider-value`) / 100.0;
  const rampUp = settings.get_double(`nonlinear-${prefix}-slider-value`);
  const ramp = x => Math.expm1(rampUp * x) / Math.expm1(rampUp);
  let minutes = Math.floor(
    (rampUp === 0 ? sliderValue : ramp(sliderValue)) *
      settings.get_int(`${prefix}-max-timer-value`)
  );

  const refstr = settings.get_string(`${prefix}-ref-timer-value`);
  // default: 'now'
  const MS = 1000 * 60;
  if (refstr.includes(':')) {
    const mh = refstr
      .split(':')
      .map(s => Number.parseInt(s))
      .filter(n => !Number.isNaN(n) && n >= 0);
    if (mh.length >= 2) {
      const d = new Date();
      const nowTime = d.getTime();
      d.setHours(mh[0]);
      d.setMinutes(mh[1]);

      if (d.getTime() + MS * minutes < nowTime) {
        d.setDate(d.getDate() + 1);
      }
      minutes += Math.floor(new Date(d.getTime() - nowTime).getTime() / MS);
    }
  } else if (prefix !== 'shutdown' && refstr === 'shutdown') {
    minutes += getSliderMinutesFromSettings(settings, 'shutdown');
  }
  return minutes;
}

/**
 * A short duration string showing >=3 hours, >=1 mins, or secs.
 *
 * @param {number} seconds duration in seconds
 */
export function durationString(seconds) {
  const sign = Math.sign(seconds);
  const absSec = Math.floor(Math.abs(seconds));
  const minutes = Math.floor(absSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 3) {
    return _n('%s hour', '%s hours', hours).format(sign * hours);
  } else if (minutes === 0) {
    return _n('%s sec', '%s secs', absSec).format(
      sign * (absSec > 5 ? 10 * Math.ceil(absSec / 10) : absSec)
    );
  }
  return _n('%s min', '%s mins', minutes).format(sign * minutes);
}

/**
 *
 * @param minutes
 * @param hrFmt
 * @param minFmt
 */
export function longDurationString(minutes, hrFmt, minFmt) {
  const hours = Math.floor(minutes / 60);
  const residualMinutes = minutes % 60;
  let parts = [minFmt(residualMinutes).format(residualMinutes)];
  if (hours) {
    parts = [hrFmt(hours).format(hours)].concat(parts);
  }
  return parts.join(' ');
}

export function absoluteTimeString(minutes, timeFmt) {
  return GLib.DateTime.new_now_local().add_minutes(minutes).format(timeFmt);
}
