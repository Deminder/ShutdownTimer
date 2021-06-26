/**
    AUTHOR: Daniel Neumann
    GJS SOURCES: https://github.com/GNOME/gnome-shell/
    COMPILING SCHEMAS: glib-compile-schemas schemas/
    EDIT LOCALE: e.g. use Poedit and open ShutdownTimer.po files
    COMPILING LOCALE: msgfmt ShutdownTimer.po -o ShutdownTimer.mo
**/

/* IMPORTS */
const {GLib, St, Gio} = imports.gi;

// screen and main functionality
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;


// menu items
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Switcher = imports.ui.switcherPopup;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;


// import own scripts
const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Timer = Extension.imports.timer;
const RootMode = Extension.imports.rootmode;
const Convenience = Extension.imports.convenience;


/* GLOBAL VARIABLES */
let textbox, submenu, slider, switcher, separator, settings, timer, checkCancel, rootMode, displayedInfo, internalScheduleInfo, externalScheduleInfo;

class ScheduleInfo {
    constructor({mode = '?', secondsLeft = 0, external = false, scheduled = false}) {
        this._v = {mode, secondsLeft, external, scheduled};
    }

    copy(vals) {
        return new ScheduleInfo({...this._v, ...vals})
    }

    get scheduled() {
        return this._v.scheduled;
    }

    get external() {
        return this._v.external;
    }

    get secondsLeft() {
        return this._v.secondsLeft;
    }
    get mode() {
        return this._v.mode;
    }

    get minutes() {
        return Math.floor(this.secondsLeft/60);
    }

    get modeText() {
        switch (this.mode) {
            case 'suspend':
                return _("suspend");
            case 'reboot':
                return _("reboot");
            default:
                return _("shutdown");
        }
    }

    get label() {
        let label = _("Shutdown Timer");
        if (this.scheduled) {
            label = `${this.minutes} ${_("min until")} ${this.modeText}` + (this.external ? ' '+_("(sys)") : '');
        }
        return label;
    }

    changedMoreThanAMinute(otherInfo) {
        return this.mode !== otherInfo.mode ||
            this.scheduled !== otherInfo.scheduled ||
            this.external !== otherInfo.external ||
            this.minutes < otherInfo.minutes;
    }

    isMoreUrgendThan(otherInfo) {
        return !otherInfo.scheduled ||
            (this.scheduled && this.secondsLeft < otherInfo.secondsLeft);
    }
}


/* ACTION FUNCTIONS */
// show textbox with message
function _showTextbox(textmsg) {
    if(!textbox) {
        textbox = new St.Label({ style_class: 'textbox-label', text: "Hello, world!" });
        Main.uiGroup.add_actor(textbox);
    }
    textbox.text = textmsg;
    textbox.opacity = 255;
    let monitor = Main.layoutManager.primaryMonitor;
    textbox.set_position(Math.floor(monitor.width / 2 - textbox.width / 2),
                      Math.floor(monitor.height / 2 - textbox.height / 2));
    textbox.ease ({
        opacity: 0,
        delay: 3000,
        duration: 1000,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: _hideTextbox
    });
}

function _hideTextbox() {
    Main.uiGroup.remove_actor(textbox);
    textbox = null;
}

function _getTimerStartValue() {
    let sliderValue = settings.get_int('slider-value') / 100.0;
    return Math.floor(sliderValue * settings.get_int('max-timer-value'));
}

// update timer value if slider has changed
function _updateSlider() {
    slider.value = settings.get_int('slider-value') / 100.0;
    _updateSwitchLabel();
}

function _updateSwitchLabel() {
    let label = `${_getTimerStartValue()} ${_("min")}`;
    if (settings.get_boolean('root-mode-value')) {
        label += ' ' + _("(root)");
    }
    switcher.label.text = label;
}

function _onRootModeChanged() {
    if (!settings.get_boolean('root-mode-value')) {
        rootMode.stopRootProc();
    }
    _updateSwitchLabel();
    Promise.all([maybeStopRootModeInsurance(), maybeStartRootModeInsurance()])
        .then(() => {
            if (!settings.get_boolean('root-mode-value')) {
                rootMode.updateScheduleInfo();
            }
        });
}

function _onModeChange() {
    // redo Root-mode insurance
    const prevScheduled = internalScheduleInfo.scheduled;
    internalScheduleInfo = internalScheduleInfo.copy({scheduled: false});
    maybeStopRootModeInsurance()
        .then(() => {
            internalScheduleInfo = internalScheduleInfo.copy({scheduled: prevScheduled});
            _updateCurrentMode();
        })
        .then(() => maybeStartRootModeInsurance());
}

    
function _onShowSettingsButtonChanged() {
    submenu.destroy();
    separator.destroy();
    render();
}

function maybeCheckCmdString() {
    return settings.get_boolean('enable-check-command-value') ?
        '\n ' + settings.get_string('check-command-value') : '';
}

function _updateCheckCommandState() {

    if (checkCancel !== null && !checkCancel.is_cancelled()) {
        // check command is running
        if(switcher.state) {
            submenu.label.text = _("Waiting for confirmation");
            showText = _("Waiting for confirmation") + maybeCheckCmdString();
        } else {
            checkCancel.cancel();
            showText = _("Confirmation canceled");
            submenu.label.text = _("Shutdown Timer");
        }
        _showTextbox(showText);
    }
}

// toggle button starts/stops shutdown timer
// also considers check command state
function _onToggle(show = true) {
    if (checkCancel !== null) {
        // toggle may cancel the check command (otherwise ignored)
        _updateCheckCommandState();
    }

    let showText;
    if(switcher.state && !internalScheduleInfo.scheduled) {
        // start shutdown timer
        const maxTimerMinutes = Math.floor(settings.get_int('slider-value') * settings.get_int('max-timer-value') / 100.0);
        internalScheduleInfo = internalScheduleInfo.copy({
            secondsLeft: maxTimerMinutes*60,
            scheduled: true
        });
        maybeStartRootModeInsurance()
            .then(() => {
                timer.startTimer(maxTimerMinutes);
                log('Timer started! ' + internalScheduleInfo.label);
            });
        showText = `${_("System will shutdown in")} ${_getTimerStartValue()} ${_("minutes")}${maybeCheckCmdString()}`;
    } else if(!switcher.state && internalScheduleInfo.scheduled) {
        // stop shutdown timer
        internalScheduleInfo = internalScheduleInfo.copy({scheduled: false});
        timer.stopTimer();
        maybeStopRootModeInsurance()
            .then(() => {
                log('Timer stopped! ' + internalScheduleInfo.copy({scheduled: true}).label);
            });
        showText = _("Shutdown Timer stopped");
    } else {
        // nothing to do
        return;
    }
    _updateShutdownInfo();

    if (show) {
        _showTextbox(showText);
    }
}

async function maybeStopRootModeInsurance() {
    if (!internalScheduleInfo.scheduled && settings.get_boolean('root-mode-value')) {
        log('Stop Root-Mode insurance for: ' + internalScheduleInfo.mode);
        try {
            await rootMode.cancelShutdown();
        } catch (err) {
            _showTextbox(_("Root-Mode insurance failed!") + '\n' + err);
            logErr(err, 'DisableRootModeInsurance');
        }
    }
}
/**
 *
 * Insure that shutdown is executed even if the GLib timer fails by running
 * shutdown in rootMode delayed by 1 minute. Suspend is not insured.
 *
 */
async function maybeStartRootModeInsurance() {
    if (internalScheduleInfo.scheduled && settings.get_boolean('root-mode-value')) {
        log('Start Root-Mode insurance for: ' + internalScheduleInfo.mode);
        try {
            switch (internalScheduleInfo.mode) {
                case 'poweroff':
                    await rootMode.shutdown(internalScheduleInfo.minutes + 1);
                    break;
                case 'reboot':
                    await rootMode.shutdown(internalScheduleInfo.minutes + 1, true);
                    break;
                default:
                    log('No Root-Mode insurance for: ' + internalScheduleInfo.mode);
            }
        } catch (err) {
            _showTextbox(_("Root-Mode insurance failed!") + '\n' + err);
            logErr(err, 'EnableRootModeInsurance');
        }
    }

}

// menu items switcher and slider
function _createSwitcherItem() {
    let switchMenuItem = new PopupMenu.PopupSwitchMenuItem('', false);
    
    switchMenuItem.connect('toggled', _onToggle);

    if(settings.get_boolean('show-settings-value')) {
        let switcherSettingsButton = new St.Button({reactive: true,
                                                    can_focus: true,
                                                    track_hover: true,
                                                    accessible_name: _("Settings"),
                                                    style_class: 'system-menu-action settings-button' });
        switcherSettingsButton.child = new St.Icon({icon_name: 'emblem-system-symbolic', 
                                                    style_class: 'popup-menu-icon' });
        switcherSettingsButton.connect('clicked', function () {
                ExtensionUtils.openPrefs();
        });
        switchMenuItem.add_actor(switcherSettingsButton);
    }
    
    return switchMenuItem;
}

function _createSliderItem() {
    let sliderValue =  settings.get_int('slider-value') / 100.0;
    let sliderItem = new PopupMenu.PopupMenuItem('');
    let sliderIcon = new St.Icon({  icon_name: 'preferences-system-time-symbolic', 
                                    style_class: 'popup-menu-icon' });
    sliderItem.actor.add(sliderIcon);
    slider = new Slider.Slider(sliderValue);
    slider.connect('notify::value', () => {
        settings.set_int('slider-value', (slider.value * 100));
        _updateSlider();
    });
    sliderItem.add_actor(slider);
    return sliderItem;
}


function _currentMode() {
    if (settings.get_boolean('use-suspend-value')) {
        return 'suspend';
    }
    return 'poweroff';
}



function _updateShutdownInfo() {
    let displayInfo = externalScheduleInfo.isMoreUrgendThan(internalScheduleInfo) ?
        externalScheduleInfo : internalScheduleInfo;
    const updateSubmenu = displayInfo.changedMoreThanAMinute(displayedInfo);
    displayedInfo = displayInfo;

    if (updateSubmenu) {
        _updateSubmenuLabel();
    }
}
function externalScheduleInfoTick(info) {
    externalScheduleInfo = externalScheduleInfo.copy({...info, scheduled: info.mode !== null});
    _updateShutdownInfo();
}

function timerTick(secondsLeft) {
    internalScheduleInfo = internalScheduleInfo.copy({ secondsLeft});
    _updateShutdownInfo();
}

function _updateCurrentMode() {
    internalScheduleInfo = internalScheduleInfo.copy({mode: _currentMode()});
    _updateShutdownInfo();
}

function _updateSubmenuLabel() {
    if (submenu) {
        submenu.label.text = displayedInfo.label;
    }
}

// timer action (shutdown/suspend)
function timerAction() {
    maybeStopRootModeInsurance();
    maybeDoCheck()
        .then(() => shutdown())
        .catch((err) => {
            logError(err, 'CheckError');
        })
        .finally(() => {
            switcher.setToggleState(false);
            _onToggle(false);
        });
}

async function maybeDoCheck() {
    const checkCommandStr = settings.get_string('check-command-value');
    const checkCommandEnabled = settings.get_boolean('enable-check-command-value');
    if (!checkCommandEnabled || !checkCommandStr.length) {
        return;
    }
    if (settings.get_boolean('root-mode-value')) {
        // avoid shutting down (with Root-Mode insurance) before check command is done
        rootMode.cancelShutdown();
    }
    if (checkCancel !== null) {
        _showTextbox(_("Confirmation canceled"));
        throw new Error('Confirmation canceled: attempted to start a second check command!');
    }
    checkCancel = new Gio.Cancellable();
    _updateCheckCommandState();
    return RootMode.execCheck(checkCommandStr, checkCancel)
        .then(() => {
            log(`Check command "${checkCommandStr}" confirmed shutdown.`);
            return;
        })
        .catch((err) => {
            let code = '?';
            if ('code' in err) {
                code = `${err.code}`;
                log("Check command aborted shutdown. Code: " + code);
            }
            _showTextbox(_('Shutdown aborted') + `\n${checkCommandStr} (Code: ${code})`);
            throw err;
        })
        .finally(() => {
            checkCancel = null;
        });
}
function shutdown() {
    log('Executing: '+ internalScheduleInfo.mode);
    switch (internalScheduleInfo.mode) {
        case 'poweroff':
            return powerOff();
        case 'suspend':
            return suspend();
        default:
            logError('Shutdown mode not supported!' + internalScheduleInfo.mode);
    }
}

// shutdown the device
function powerOff() {
    Main.overview.hide();

    const GnomeSession = imports.misc.gnomeSession;
    let session = new GnomeSession.SessionManager();
    session.ShutdownRemote(0);	// shutdown after 60s

    // const Util = imports.misc.util;
    //Util.spawnCommandLine('poweroff');	// shutdown immediately
}

// suspend the device
function suspend() {
    Main.overview.hide();

    const LoginManager = imports.misc.loginManager;
    let loginManager = LoginManager.getLoginManager();
    loginManager.suspend();
}

function render() {
    // submenu in status area menu with slider and toggle button
    let sliderItem = _createSliderItem();
    switcher = _createSwitcherItem();
    _updateSwitchLabel();
    
    submenu = new PopupMenu.PopupSubMenuMenuItem('', true);
    submenu.icon.icon_name = 'system-shutdown-symbolic';
    submenu.menu.addMenuItem(switcher);
    submenu.menu.addMenuItem(sliderItem);

    // add separator line and submenu in status area menu
    separator = new PopupMenu.PopupSeparatorMenuItem();
    let statusMenu = Main.panel.statusArea['aggregateMenu'];
    statusMenu.menu.addMenuItem(separator);
    statusMenu.menu.addMenuItem(submenu);

    _updateSubmenuLabel();
}

/* EXTENSION MAIN FUNCTIONS */
function init() {
    // initialize translations
    Convenience.initTranslations();

    // initialize settings
    settings = Convenience.getSettings();

    checkCancel = null;
}

function enable() {
    // initialize timer
    timer = new Timer.Timer(timerAction, timerTick);
    rootMode = new RootMode.RootMode(externalScheduleInfoTick);

    externalScheduleInfo = new ScheduleInfo({external: true});
    internalScheduleInfo = new ScheduleInfo({external: false});
    displayedInfo = internalScheduleInfo;
    _updateCurrentMode();

    // render menu widget
    render();

    // handlers for changed values in settings
    settings.connect('changed::max-timer-value', _updateSwitchLabel);
    settings.connect('changed::slider-value', _updateSlider);
    settings.connect('changed::root-mode-value', _onRootModeChanged);
    settings.connect('changed::show-settings-value', _onShowSettingsButtonChanged);
    settings.connect('changed::use-suspend-value', _onModeChange);
}


function disable() {
    // root mode insurance will NOT be stopped
    internalScheduleInfo = internalScheduleInfo.copy({scheduled: false});
    timer.stopTimer();
    submenu.destroy(); // destroys switcher and sliderItem as children too
    separator.destroy();
    if (checkCancel !== null && !checkCancel.is_cancelled()) {
        checkCancel.cancel();
        checkCancel = null;
    }
    rootMode.cleanup();
}
