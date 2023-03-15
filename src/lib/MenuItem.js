/**
 * MenuItem module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported ShutdownTimerIndicator, init, uninit, MODES */

const { GObject, St, Gio, Clutter, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { CheckCommand, Convenience, InfoFetcher, ScheduleInfo } = Me.imports.lib;
const {
  logDebug,
  modeLabel,
  MODES,
  WAKE_MODES,
  durationString,
  longDurationString,
  absoluteTimeString,
} = Convenience;

// menu items
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const { QuickMenuToggle, SystemIndicator } = imports.ui.quickSettings;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const _n = Gettext.ngettext;
const C_ = Gettext.pgettext;

const { PACKAGE_VERSION } = imports.misc.config;
const MAJOR = Number.parseInt(PACKAGE_VERSION);

var ShutdownTimerItem = GObject.registerClass(
  {
    Properties: {
      'shutdown-text': GObject.ParamSpec.string(
        'shutdown-text',
        '',
        '',
        GObject.ParamFlags.READWRITE,
        ''
      ),
      'indicator-icon-name': GObject.ParamSpec.string(
        'indicator-icon-name',
        '',
        '',
        GObject.ParamFlags.READWRITE,
        'go-down-symbolic'
      ),
      'wake-minutes': GObject.ParamSpec.int(
        'wake-minutes',
        '',
        '',
        GObject.ParamFlags.READABLE,
        0
      ),
      'shutdown-minutes': GObject.ParamSpec.int(
        'shutdown-minutes',
        '',
        '',
        GObject.ParamFlags.READABLE,
        0
      ),
    },
    Signals: {
      'external-info': {},
      shutdown: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
      wake: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
    },
  },
  class ShutdownTimerItem extends QuickMenuToggle {
    _init(props) {
      const gicon = Gio.icon_new_for_string(
        `${Me.path}/icons/shutdown-timer-symbolic.svg`
      );
      const nprops = { gicon, accessible_name: _('Shutdown Timer') };
      if (MAJOR >= 44) nprops.subtitle = _('Shutdown Timer');
      super._init({ ...nprops, ...props });
      this._settings = ExtensionUtils.getSettings();
      this.shutdownTimerIcon = gicon;

      this.externalScheduleInfo = new ScheduleInfo.ScheduleInfo({
        external: true,
      });
      this.externalWakeInfo = new ScheduleInfo.ScheduleInfo({
        external: false,
        mode: 'wake',
      });

      // track external shutdown and wake schedule
      this.infoFetcher = new InfoFetcher.InfoFetcher();
      this.infoFetcher.connectObject(
        'changed',
        () => {
          this.externalScheduleInfo = this.externalScheduleInfo.copy({
            ...this.infoFetcher.shutdownInfo,
          });
          this.externalWakeInfo = this.externalWakeInfo.copy({
            ...this.infoFetcher.wakeInfo,
          });
          this.updateShutdownInfo();
        },
        this
      );

      // submenu in status area menu with slider and toggle button
      this.sliderItems = {};
      this.sliders = {};
      ['shutdown', 'wake'].forEach(prefix => {
        const [item, slider] = this._createSliderItem(prefix);
        this.sliderItems[prefix] = item;
        this.sliders[prefix] = slider;
        this._onShowSliderChanged(prefix);
      });
      this.switcher = new PopupMenu.PopupSwitchMenuItem('', false);
      // start/stop shutdown timer
      this.switcher.connect('toggled', () =>
        this.emit('shutdown', this.switcher.state)
      );
      this.switcherSettingsButton = new St.Button({
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name: _('Settings'),
        style_class: 'system-menu-action settings-button',
      });
      this.switcherSettingsButton.child = new St.Icon({
        icon_name: 'emblem-system-symbolic',
        style_class: 'popup-menu-icon',
      });
      this.switcherSettingsButton.connect('clicked', () =>
        ExtensionUtils.openPrefs()
      );
      this.switcher.add_child(this.switcherSettingsButton);

      this.menu.addMenuItem(this.switcher);
      // make switcher toggle without popup menu closing
      this.switcher.activate = __ => {
        if (this.switcher._switch.mapped) {
          this.switcher.toggle();
        }
      };
      this.menu.addMenuItem(this.sliderItems['shutdown']);

      this.modeItems = MODES.map(mode => {
        const modeItem = new PopupMenu.PopupMenuItem(modeLabel(mode));
        modeItem.connect('activate', () => {
          this._settings.set_string('shutdown-mode-value', mode);
          this.emit('shutdown', true);
        });
        this.menu.addMenuItem(modeItem);
        return [mode, modeItem];
      });

      this.wakeItems = [
        new PopupMenu.PopupSeparatorMenuItem(),
        this.sliderItems['wake'],
        ...WAKE_MODES.map(mode => {
          const modeItem = new PopupMenu.PopupMenuItem(modeLabel(mode));
          if (mode === 'wake') {
            this.wakeModeItem = modeItem;
          }
          modeItem.connect('activate', () =>
            this.emit('wake', mode === 'wake')
          );
          return modeItem;
        }),
      ];
      this.wakeItems.forEach(item => {
        this.menu.addMenuItem(item);
      });
      this._updateWakeModeItem();
      this._updateSwitchLabel();

      // handlers for changed values in settings
      const settingsHandlerIds = [
        [
          [
            'shutdown-max-timer-value',
            'nonlinear-shutdown-slider-value',
            'shutdown-ref-timer-value',
            'show-shutdown-absolute-timer-value',
            'root-mode-value',
            'shutdown-slider-value',
          ],
          () => this._updateSwitchLabel(),
        ],
        [
          [
            'wake-max-timer-value',
            'wake-ref-timer-value',
            'show-wake-absolute-timer-value',
            'nonlinear-wake-slider-value',
            'wake-slider-value',
          ],
          () => this._updateWakeModeItem(),
        ],
        [['shutdown-slider-value'], () => this._updateSlider('shutdown')],
        [['wake-slider-value'], () => this._updateSlider('wake')],
        [
          [
            'show-wake-items-value',
            'show-shutdown-mode-value',
            'show-shutdown-slider-value',
            'show-wake-slider-value',
            'show-shutdown-indicator-value',
            'show-settings-value',
            'shutdown-mode-value',
            'shutdown-timestamp-value',
          ],
          () => this._sync(),
        ],
      ]
        .flatMap(([names, func]) => names.map(n => [n, func]))
        .map(([name, func]) =>
          this._settings.connect(`changed::${name}`, func)
        );
      this.connect('clicked', () => this.switcher.toggle());
      const tickHandlerId = setInterval(() => this.updateShutdownInfo(), 1000);
      this.connect('destroy', () => {
        clearInterval(tickHandlerId);
        this.infoFetcher.destroy();
        this.infoFetcher = null;
        settingsHandlerIds.forEach(handlerId => {
          this._settings.disconnect(handlerId);
        });
      });
      this._sync();
    }

    _sync() {
      // Update wake mode items
      this.wakeItems.forEach(item => {
        item.visible = this._settings.get_boolean('show-wake-items-value');
      });
      this._onShowSliderChanged('wake');

      // Update shutdown mode items
      const activeModes = this._settings
        .get_string('show-shutdown-mode-value')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => MODES.includes(s));
      this.modeItems.forEach(([mode, item]) => {
        const position = activeModes.indexOf(mode);
        if (position > -1) {
          this.menu.moveMenuItem(item, position + 2);
        }
        item.visible = position > -1;
      });
      const info = this.shutdownScheduleInfo;
      this.modeItems.forEach(([mode, item]) => {
        item.setOrnament(
          mode === info.mode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE
        );
      });
      this[MAJOR >= 44 ? 'title' : 'label'] = modeLabel(info.mode);
      this._onShowSliderChanged('shutdown');

      // Update switcher
      this.switcher.setToggleState(info.scheduled);
      this.updateShutdownInfo();
      this.switcherSettingsButton.visible = this._settings.get_boolean(
        'show-settings-value'
      );
    }

    updateShutdownInfo() {
      const showIndicator = this._settings.get_boolean(
        'show-shutdown-indicator-value'
      );
      const info = this.externalScheduleInfo.isMoreUrgendThan(
        this.shutdownScheduleInfo
      )
        ? this.externalScheduleInfo
        : this.shutdownScheduleInfo;
      const checkRunning =
        this.shutdownScheduleInfo.scheduled && CheckCommand.isChecking();
      this.set({
        checked: this.shutdownScheduleInfo.scheduled,
        shutdownText:
          info.scheduled && showIndicator
            ? info.secondsLeft > 0
              ? durationString(info.secondsLeft)
              : _('now')
            : '',
        indicatorIconName:
          showIndicator &&
          (this.shutdownScheduleInfo.scheduled ||
            this.externalScheduleInfo.scheduled)
            ? checkRunning
              ? 'go-down-symbolic'
              : 'go-bottom-symbolic'
            : '',
      });
      this.menu.setHeader(
        this.shutdownTimerIcon,
        _('Shutdown Timer'),
        [
          checkRunning
            ? _('Check %s for %s').format(
                this.shutdownScheduleInfo.modeText,
                durationString(
                  // Show seconds which passed since check started
                  Math.max(0, -this.shutdownScheduleInfo.secondsLeft)
                )
              )
            : info.label,
          this.externalWakeInfo.label,
        ]
          .filter(v => !!v)
          .join('\n')
      );
      if (this._settings.get_boolean('show-shutdown-absolute-timer-value')) {
        this._updateSwitchLabel();
      }
      if (this._settings.get_boolean('show-wake-absolute-timer-value')) {
        this._updateWakeModeItem();
      }
    }

    // update timer value if slider has changed
    _updateSlider(prefix) {
      this.sliders[prefix].value =
        this._settings.get_double(`${prefix}-slider-value`) / 100.0;
    }

    _createSliderItem(settingsPrefix) {
      const sliderValue =
        this._settings.get_double(`${settingsPrefix}-slider-value`) / 100.0;
      const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
      const sliderIcon = new St.Icon({
        icon_name:
          settingsPrefix === 'wake'
            ? 'alarm-symbolic'
            : 'system-shutdown-symbolic',
        style_class: 'popup-menu-icon',
      });
      item.add(sliderIcon);
      const slider = new Slider.Slider(sliderValue);
      slider.connect('notify::value', () => {
        this._settings.set_double(
          `${settingsPrefix}-slider-value`,
          slider.value * 100
        );
      });
      item.add_child(slider);
      return [item, slider];
    }

    _updateSwitchLabel() {
      const minutes = Math.abs(this._getSliderMinutes('shutdown'));
      const timeStr = this._settings.get_boolean(
        'show-shutdown-absolute-timer-value'
      )
        ? absoluteTimeString(minutes, C_('absolute time notation', '%a, %R'))
        : longDurationString(
            minutes,
            h => _n('%s hr', '%s hrs', h),
            m => _n('%s min', '%s mins', m)
          );
      this.switcher.label.text = this._settings.get_boolean('root-mode-value')
        ? _('%s (protect)').format(timeStr)
        : timeStr;

      if (this._settings.get_string('wake-ref-timer-value') === 'shutdown') {
        this._updateWakeModeItem();
      }
    }

    _updateWakeModeItem() {
      const minutes = Math.abs(this.wake_minutes);
      const abs = this._settings.get_boolean('show-wake-absolute-timer-value');
      this.wakeModeItem.label.text = (
        abs
          ? C_('WakeButtonText', '%s at %s')
          : C_('WakeButtonText', '%s after %s')
      ).format(
        modeLabel('wake'),
        abs
          ? absoluteTimeString(minutes, C_('absolute time notation', '%a, %R'))
          : longDurationString(
              minutes,
              h => _n('%s hour', '%s hours', h),
              m => _n('%s minute', '%s minutes', m)
            )
      );
    }

    _onShowSliderChanged(settingsPrefix) {
      this.sliderItems[settingsPrefix].visible =
        (settingsPrefix !== 'wake' ||
          this._settings.get_boolean('show-wake-items-value')) &&
        this._settings.get_boolean(`show-${settingsPrefix}-slider-value`);
    }

    _getSliderMinutes(prefix) {
      const sliderValue =
        this._settings.get_double(`${prefix}-slider-value`) / 100.0;
      const rampUp = this._settings.get_double(
        `nonlinear-${prefix}-slider-value`
      );
      const ramp = x => Math.expm1(rampUp * x) / Math.expm1(rampUp);
      let minutes = Math.floor(
        (rampUp === 0 ? sliderValue : ramp(sliderValue)) *
          this._settings.get_int(`${prefix}-max-timer-value`)
      );

      const refstr = this._settings.get_string(`${prefix}-ref-timer-value`);
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
        minutes += this._getSliderMinutes('shutdown');
      }
      return minutes;
    }

    get shutdown_minutes() {
      return this._getSliderMinutes('shutdown');
    }

    get wake_minutes() {
      return this._getSliderMinutes('wake');
    }

    get shutdownScheduleInfo() {
      return new ScheduleInfo.ScheduleInfo({
        mode: this._settings.get_string('shutdown-mode-value'),
        deadline: this._settings.get_int('shutdown-timestamp-value'),
      });
    }

    on_external_info() {
      this.infoFetcher.refresh();
    }
  }
);

var ShutdownTimerIndicator = GObject.registerClass(
  {
    Properties: {
      'wake-minutes': GObject.ParamSpec.int(
        'wake-minutes',
        '',
        '',
        GObject.ParamFlags.READABLE,
        0
      ),
      'shutdown-minutes': GObject.ParamSpec.int(
        'shutdown-minutes',
        '',
        '',
        GObject.ParamFlags.READABLE,
        0
      ),
    },
    Signals: {
      'external-info': {},
      shutdown: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
      wake: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
    },
  },
  class ShutdownTimerIndicator extends SystemIndicator {
    _init() {
      super._init();
      const item = new ShutdownTimerItem();
      this._shutdownTimerItem = item;

      item.connect('shutdown', (__, shutdown) =>
        this.emit('shutdown', shutdown)
      );
      item.connect('wake', (__, wake) => this.emit('wake', wake));

      const icon = new St.Icon({ style_class: 'system-status-icon' });
      const updateIcon = () => {
        const name = item.indicatorIconName;
        icon.visible = !!name;
        if (icon.visible) icon.iconName = name;
        this._syncIndicatorsVisible();
      };

      const scheduleLabel = new St.Label({
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      const updateLabel = () => {
        const text = item.shutdownText;
        scheduleLabel.text = text;
        scheduleLabel.visible = !!text;
        this._syncIndicatorsVisible();
      };

      this.add_actor(icon);
      this.add_child(scheduleLabel);

      item.connect('notify::indicator-icon-name', () => updateIcon());
      item.connect('notify::shutdown-text', () => updateLabel());

      updateLabel();
      updateIcon();

      this.quickSettingsItems.push(item);
      this.connect('destroy', () => {
        this.quickSettingsItems.forEach(i => i.destroy());
      });
    }

    get shutdown_minutes() {
      return this._shutdownTimerItem.shutdown_minutes;
    }

    get wake_minutes() {
      return this._shutdownTimerItem.wake_minutes;
    }

    on_external_info() {
      this._shutdownTimerItem.emit('external-info');
    }
  }
);
