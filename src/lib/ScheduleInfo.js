/*
  AUTHOR: Deminder
*/
/* exported ScheduleInfo, durationString */
const { GLib } = imports.gi;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const _n = Gettext.ngettext;

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
    let label = _('Shutdown Timer');
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

function durationString(seconds) {
  const sign = Math.sign(seconds);
  const absSec = Math.floor(Math.abs(seconds));
  const minutes = Math.floor(absSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 3) {
    return _n('%s hour', '%s hours', hours).format(sign * hours);
  } else if (minutes === 0) {
    return _n('%s sec', '%s secs', absSec).format(sign * absSec);
  }
  return _n('%s min', '%s mins', minutes).format(sign * minutes);
}
