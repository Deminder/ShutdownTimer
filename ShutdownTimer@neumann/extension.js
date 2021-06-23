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
const Convenience = Extension.imports.convenience;


/* GLOBAL VARIABLES */
let textbox, submenu, slider, switcher, separator, settings, timer;


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
        duration: 4000,
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
function _onSliderChanged() {
    settings.set_int('slider-value', (slider.value * 100));
    switcher.label.text = _getTimerStartValue().toString() + ' min';
    
    if (settings.get_boolean('root-mode-value')) {
        switcher.label.text = _getTimerStartValue().toString() + ' min (root)'; 
    }
}

function _onSettingsChanged() {
    let sliderValue =  settings.get_int('slider-value') / 100.0;
    slider.value = sliderValue;
    switcher.label.text = _getTimerStartValue().toString() + ' ' +_("min");
    
    if (settings.get_boolean('root-mode-value')) {
        switcher.label.text = _getTimerStartValue().toString() + ' ' +_("min (root)");
    }
}

function _onShowSettingsButtonChanged() {
    submenu.destroy();
    separator.destroy();
    render();
}

// toggle button starts/stops shutdown timer
function _onToggle() {
    if(switcher.state) {
        timer.startTimer();
        _showTextbox(   _("System will shutdown in")+ ' ' 
                        + _getTimerStartValue().toString() + ' '+_("minutes")
                        + '\n [' + settings.get_string('check-command-value') + ']');
    } else {
        timer.stopTimer();
        _showTextbox(_("Shutdown Timer stopped"));
        submenu.label.text = _("Shutdown Timer");
    }
}

// menu items switcher and slider
function _createSwitcherItem() {
    let switchMenuItem = new PopupMenu.PopupSwitchMenuItem('', false);
    switchMenuItem.label.text = _getTimerStartValue().toString() + ' ' +_("min");
    if(settings.get_boolean('root-mode-value')) {
        switchMenuItem.label.text = _getTimerStartValue().toString() + ' ' +_("min (root)");
    }
    
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
    slider.connect('notify::value', _onSliderChanged);
    sliderItem.add_actor(slider);
    return sliderItem;
}

/**
 * Execute a command asynchronously and check the exit status.
 *
 * If given, @cancellable can be used to stop the process before it finishes.
 *
 * @param {string[] | string} argv - a list of string arguments or command line that will be parsed
 * @param {Gio.Cancellable} [cancellable] - optional cancellable object
 * @returns {Promise<boolean>} - The process success
 */
async function execCheck(argv, cancellable = null) {
    if (argv instanceof String) {
        try {
            argv = GLib.shell_parse_argv( command_line )[1];
        } catch (e) {
            return Promise.reject(e);
        }
    }
    let cancelId = 0;
    let proc = new Gio.Subprocess({
        argv: argv,
        flags: Gio.SubprocessFlags.NONE
    });
    proc.init(cancellable);

    if (cancellable instanceof Gio.Cancellable) {
        cancelId = cancellable.connect(() => proc.force_exit());
    }

    return new Promise((resolve, reject) => {
        proc.wait_check_async(null, (proc, res) => {
            try {
                if (!proc.wait_check_finish(res)) {
                    let status = proc.get_exit_status();

                    throw new Gio.IOErrorEnum({
                        code: Gio.io_error_from_errno(status),
                        message: GLib.strerror(status)
                    });
                }

                resolve();
            } catch (e) {
                reject(e);
            } finally {
                if (cancelId > 0) {
                    cancellable.disconnect(cancelId);
                }
            }
        });
    });
}

// timer action (shutdown/suspend)
function timerAction() {
    const turnOffAction = () => {
        if(settings.get_boolean('use-suspend-value')) {
            suspend();
        } else {
            powerOff();
        }
    };
    const checkCommandStr = settings.get_string('check-command-value');
    if (!checkCommandStr.length) {
        turnOffAction();
    } else {
        execCheck(checkCommandStr)
            .then(() => turnOffAction())
            .catch((e) => {
                if ('message' in e) {
                    _showTextbox('Shutdown aborted!\n' + e.message);
                }
                logError(e, "CheckCommandError");
            });
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
    
    submenu = new PopupMenu.PopupSubMenuMenuItem(_("Shutdown Timer"), true);
    submenu.icon.icon_name = 'system-shutdown-symbolic';
    submenu.menu.addMenuItem(switcher);
    submenu.menu.addMenuItem(sliderItem);
    timer.setMenuLabel(submenu.label);

    // add separator line and submenu in status area menu
    separator = new PopupMenu.PopupSeparatorMenuItem();
    let statusMenu = Main.panel.statusArea['aggregateMenu'];
    statusMenu.menu.addMenuItem(separator);
    statusMenu.menu.addMenuItem(submenu);
}

/* EXTENSION MAIN FUNCTIONS */
function init() {
    // initialize translations
    Convenience.initTranslations();

    // initialize settings
    settings = Convenience.getSettings();
}

function enable() {
    // initialize timer
    timer = new Timer.Timer(timerAction);

    // render menu widget
    render();

    // handlers for changed values in settings
    settings.connect('changed::max-timer-value', _onSettingsChanged);
    settings.connect('changed::slider-value', _onSettingsChanged);
    settings.connect('changed::root-mode-value', _onSettingsChanged);
    settings.connect('changed::show-settings-value', _onShowSettingsButtonChanged);
}

function disable() {
    timer.stopTimer(); // removes timer from Mainloop
    submenu.destroy(); // destroys switcher and sliderItem as children too
    separator.destroy();
}
