/**
 * MenuItem module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported ShutdownTimer, init, uninit, MODES */

const { GObject, St, Gio, Clutter } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience, InfoFetcher, ScheduleInfo } = Me.imports.lib;
const {
  logDebug,
  modeLabel,
  MODES,
  WAKE_MODES,
  durationString,
  longDurationString,
  guiIdle,
} = Convenience;

// menu items
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const _n = Gettext.ngettext;
const C_ = Gettext.pgettext;

let ACTIONS;
let settings;

var ShutdownTimer = GObject.registerClass(
  class ShutdownTimer extends PopupMenu.PopupSubMenuMenuItem {
    _init() {
      super._init('', true);
      // track external shutdown and wake schedule
      this.infoFetcher = new InfoFetcher.InfoFetcher(
        this._externalScheduleInfoTick.bind(this)
      );

      this.checkRunning = false;
      this.externalScheduleInfo = new ScheduleInfo.ScheduleInfo({
        external: true,
      });
      this.externalWakeInfo = new ScheduleInfo.ScheduleInfo({
        external: false,
        mode: 'wake',
      });
      this.internalScheduleInfo = new ScheduleInfo.ScheduleInfo({
        external: false,
        deadline: settings.get_int('shutdown-timestamp-value'),
        mode: settings.get_string('shutdown-mode-value'),
      });

      // submenu in status area menu with slider and toggle button
      this.sliderItems = {};
      this.sliders = {};
      ['shutdown', 'wake'].forEach(prefix => {
        const [item, slider] = _createSliderItem(prefix);
        this.sliderItems[prefix] = item;
        this.sliders[prefix] = slider;
        this._onShowSliderChanged(prefix);
      });
      this.switcher = new PopupMenu.PopupSwitchMenuItem('', false);
      _connect(this.switcher, [['toggled', this._onToggle.bind(this)]]);
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
      _connect(this.switcherSettingsButton, [
        [
          'clicked',
          async () => {
            try {
              const r = ExtensionUtils.openPrefs();
              if (r) {
                await r;
              }
            } catch {
              logDebug('failed to open preferences!');
            }
          },
        ],
      ]);
      this.switcher.add_child(this.switcherSettingsButton);

      this._onShowSettingsButtonChanged();
      this._updateSwitchLabel();
      this.icon.icon_name = 'preferences-system-time-symbolic';
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
        _connect(modeItem, [
          [
            'activate',
            () => {
              this._startMode(mode);
            },
          ],
        ]);
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
          _connect(modeItem, [
            [
              'activate',
              () => ACTIONS.wakeAction(mode, _getSliderMinutes('wake')),
            ],
          ]);
          return modeItem;
        }),
      ];
      this._updateWakeModeItem();
      this.wakeItems.forEach(item => {
        this.menu.addMenuItem(item);
      });
      this._updateShownWakeItems();
      this._updateShownModeItems();
      this._updateSelectedModeItems();
      this._onInternalShutdownTimestampChanged();

      // handlers for changed values in settings
      this.settingsHandlerIds = [
        ['shutdown-max-timer-value', this._updateSwitchLabel.bind(this)],
        ['nonlinear-shutdown-slider-value', this._updateSwitchLabel.bind(this)],
        ['wake-max-timer-value', this._updateWakeModeItem.bind(this)],
        ['nonlinear-wake-slider-value', this._updateWakeModeItem.bind(this)],
        [
          'shutdown-slider-value',
          () => {
            this._updateSlider('shutdown');
            this._updateSwitchLabel();
          },
        ],
        [
          'wake-slider-value',
          () => {
            this._updateSlider('wake');
            this._updateWakeModeItem();
          },
        ],
        ['root-mode-value', this._onRootModeChanged.bind(this)],
        ['show-settings-value', this._onShowSettingsButtonChanged.bind(this)],
        [
          'show-shutdown-slider-value',
          () => this._onShowSliderChanged('shutdown'),
        ],
        ['show-wake-slider-value', () => this._onShowSliderChanged('wake')],
        ['show-wake-items-value', this._updateShownWakeItems.bind(this)],
        ['show-shutdown-mode-value', this._updateShownModeItems.bind(this)],
        ['shutdown-mode-value', this._onModeChange.bind(this)],
        [
          'shutdown-timestamp-value',
          this._onInternalShutdownTimestampChanged.bind(this),
        ],
      ].map(([label, func]) => settings.connect(`changed::${label}`, func));
    }

    _onRootModeChanged() {
      Promise.all([
        ACTIONS.maybeStopRootModeProtection(this.internalScheduleInfo),
        ACTIONS.maybeStartRootModeProtection(this.internalScheduleInfo),
      ]).then(() => {
        this._updateSwitchLabel();
      });
    }

    _onModeChange() {
      // redo Root-mode protection
      ACTIONS.maybeStopRootModeProtection(this.internalScheduleInfo, true)
        .then(() => {
          this._updateCurrentMode();
          logDebug(`Shutdown mode: ${this.internalScheduleInfo.mode}`);
          guiIdle(this._updateSelectedModeItems.bind(this));
        })
        .then(() =>
          ACTIONS.maybeStartRootModeProtection(this.internalScheduleInfo)
        );
    }

    _updateCurrentMode() {
      this.internalScheduleInfo = this.internalScheduleInfo.copy({
        mode: settings.get_string('shutdown-mode-value'),
      });

      ACTIONS.onShutdownScheduleChange(this.internalScheduleInfo);
      this.updateShutdownInfo();
    }

    _onInternalShutdownTimestampChanged() {
      this.internalScheduleInfo = this.internalScheduleInfo.copy({
        deadline: settings.get_int('shutdown-timestamp-value'),
      });

      ACTIONS.onShutdownScheduleChange(this.internalScheduleInfo);
      this.switcher.setToggleState(this.internalScheduleInfo.scheduled);
      this.updateShutdownInfo();
    }

    /* Schedule Info updates */
    _externalScheduleInfoTick(info, wakeInfo) {
      this.externalScheduleInfo = this.externalScheduleInfo.copy({
        ...info,
      });
      this.externalWakeInfo = this.externalWakeInfo.copy({ ...wakeInfo });
      guiIdle(this.updateShutdownInfo.bind(this));
    }

    _updateShownModeItems() {
      const activeModes = settings
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
    }

    updateShutdownInfo() {
      let shutdownLabel;
      if (this.internalScheduleInfo.scheduled && this.checkRunning) {
        const secPassed = Math.max(0, -this.internalScheduleInfo.secondsLeft);
        shutdownLabel = _('Check %s for %s').format(
          this.internalScheduleInfo.modeText,
          durationString(secPassed)
        );
      } else {
        const info = this.externalScheduleInfo.isMoreUrgendThan(
          this.internalScheduleInfo
        )
          ? this.externalScheduleInfo
          : this.internalScheduleInfo;
        shutdownLabel = info.label;
      }
      this.label.text =
        [shutdownLabel, this.externalWakeInfo.label]
          .filter(v => !!v)
          .join('\n') || _('Shutdown Timer');
    }

    _updateSelectedModeItems() {
      this.modeItems.forEach(([mode, item]) => {
        item.setOrnament(
          mode === this.internalScheduleInfo.mode
            ? PopupMenu.Ornament.DOT
            : PopupMenu.Ornament.NONE
        );
      });
    }

    // update timer value if slider has changed
    _updateSlider(prefix) {
      this.sliders[prefix].value =
        settings.get_double(`${prefix}-slider-value`) / 100.0;
    }

    _updateSwitchLabel() {
      const minutes = Math.abs(_getSliderMinutes('shutdown'));
      const timeStr = longDurationString(
        minutes,
        h => _n('%s hr', '%s hrs', h),
        m => _n('%s min', '%s mins', m)
      );
      this.switcher.label.text = settings.get_boolean('root-mode-value')
        ? _('%s (protect)').format(timeStr)
        : timeStr;
    }

    _updateWakeModeItem() {
      const minutes = Math.abs(_getSliderMinutes('wake'));
      this.wakeModeItem.label.text = C_('WakeButtonText', '%s %s').format(
        modeLabel('wake'),
        longDurationString(
          minutes,
          h => _n('%s hour', '%s hours', h),
          m => _n('%s minute', '%s minutes', m)
        )
      );
    }

    _onShowSettingsButtonChanged() {
      this.switcherSettingsButton.visible = settings.get_boolean(
        'show-settings-value'
      );
    }

    _updateShownWakeItems() {
      this.wakeItems.forEach(item => {
        item.visible = settings.get_boolean('show-wake-items-value');
      });
      this._onShowSliderChanged('wake');
    }

    _onShowSliderChanged(settingsPrefix) {
      this.sliderItems[settingsPrefix].visible =
        (settingsPrefix !== 'wake' ||
          settings.get_boolean('show-wake-items-value')) &&
        settings.get_boolean(`show-${settingsPrefix}-slider-value`);
    }

    _startMode(mode) {
      settings.set_string('shutdown-mode-value', mode);
      ACTIONS.startSchedule(
        _getSliderMinutes('shutdown'),
        _getSliderMinutes('wake')
      );
    }

    // toggle button starts/stops shutdown timer
    _onToggle() {
      if (this.switcher.state) {
        // start shutdown timer
        ACTIONS.startSchedule(
          _getSliderMinutes('shutdown'),
          _getSliderMinutes('wake')
        );
      } else {
        // stop shutdown timer
        ACTIONS.stopSchedule();
      }
    }

    destroy() {
      this.infoFetcher.stop();
      this.settingsHandlerIds.forEach(handlerId => {
        settings.disconnect(handlerId);
      });
      this.settingsHandlerIds = [];
      super.destroy();
    }
  }
);

/**
 *
 * @param settingsObj
 * @param actions
 */
function init(settingsObj, actions) {
  settings = settingsObj;
  ACTIONS = actions;
}

/**
 *
 */
function uninit() {
  settings = null;
  ACTIONS = null;
}

/**
 *
 * @param prefix
 */
function _getSliderMinutes(prefix) {
  let sliderValue = settings.get_double(`${prefix}-slider-value`) / 100.0;
  const rampUp = settings.get_double(`nonlinear-${prefix}-slider-value`);
  const ramp = x => Math.expm1(rampUp * x) / Math.expm1(rampUp);
  return Math.floor(
    (rampUp === 0 ? sliderValue : ramp(sliderValue)) *
      settings.get_int(`${prefix}-max-timer-value`)
  );
}

/**
 *
 * @param item
 * @param connections
 */
function _connect(item, connections) {
  const handlerIds = connections.map(([label, func]) =>
    item.connect(label, func)
  );
  const destroyId = item.connect('destroy', () => {
    handlerIds.concat(destroyId).forEach(handlerId => {
      item.disconnect(handlerId);
    });
  });
}

/**
 *
 * @param settingsPrefix
 */
function _createSliderItem(settingsPrefix) {
  const sliderValue =
    settings.get_double(`${settingsPrefix}-slider-value`) / 100.0;
  const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
  const sliderIcon = new St.Icon({
    icon_name:
      settingsPrefix === 'wake' ? 'alarm-symbolic' : 'system-shutdown-symbolic',
    style_class: 'popup-menu-icon',
  });
  item.add(sliderIcon);
  const slider = new Slider.Slider(sliderValue);
  _connect(slider, [
    [
      'notify::value',
      () => {
        settings.set_double(
          `${settingsPrefix}-slider-value`,
          slider.value * 100
        );
      },
    ],
  ]);
  item.add_child(slider);
  return [item, slider];
}
