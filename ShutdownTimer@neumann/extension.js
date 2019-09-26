/**
	AUTHOR: Daniel Neumann
	GJS SOURCES: https://github.com/GNOME/gnome-shell/
	COMPILING SCHEMAS: glib-compile-schemas schemas/
	COMPILING LOCALE: msgfmt ShutdownTimer.po -o ShutdownTimer.mo
**/

/* IMPORTS */
// icons and labels
const St = imports.gi.St;

// screen and main functionality
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

// menu items
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Switcher = imports.ui.switcherPopup;

// shutdown functionality
const GnomeSession = imports.misc.gnomeSession;
const Util = imports.misc.util;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;


// import own scripts
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Timer = Extension.imports.timer;
const Convenience = Extension.imports.convenience;


/* GLOBAL VARIABLES */
let textbox, submenu, slider, switcher, separator, timer, settings;


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
	Tweener.addTween(textbox,
		             { opacity: 0,
		               time: 4,
		               transition: 'easeOutQuad',
		               onComplete: _hideTextbox });
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
	
	if(settings.get_boolean('root-mode-value')) {
	    switcher.label.text = _getTimerStartValue().toString() + ' min (root)'; 
	}
}

function _onSettingsChanged() {
    let sliderValue =  settings.get_int('slider-value') / 100.0;
    slider.setValue(sliderValue);
	switcher.label.text = _getTimerStartValue().toString() + ' ' +_("min");
	
	if(settings.get_boolean('root-mode-value')) {
	    switcher.label.text = _getTimerStartValue().toString() + ' ' +_("min (root)");
	}
}

// toggle button starts/stops shutdown timer
function _onToggle() {
	if(switcher.state) {
		timer.startTimer();
		_showTextbox(   _("System will shutdown in")+ ' ' 
		                + _getTimerStartValue().toString() + ' '+_("minutes"));
	} else {
		timer.stopTimer();
		_showTextbox(_("Shutdown Timer stopped"));
		submenu.label.text = _("Shutdown Timer");
	}
}

// menu items switcher and slider
function _createSwitcherItem() {
    let switchMenuItem = new PopupMenu.PopupSwitchMenuItem('');
    switchMenuItem.label.text = _getTimerStartValue().toString() + ' ' +_("min");
    if(settings.get_boolean('root-mode-value')) {
	    switchMenuItem.label.text = _getTimerStartValue().toString() + ' ' +_("min (root)");
	}
    
	switchMenuItem.connect('toggled', _onToggle);
	let switcherSettingsButton = new St.Button({reactive: true,
                                                can_focus: true,
                                                track_hover: true,
                                                accessible_name: _("Settings"),
                                                style_class: 'system-menu-action settings-button' });
    switcherSettingsButton.child = new St.Icon({icon_name: 'emblem-system-symbolic', 
                                                style_class: 'popup-menu-icon' });
    switcherSettingsButton.connect('clicked', function () {
            Util.spawn(["gnome-shell-extension-prefs", Extension.metadata.uuid]);
    });
    switchMenuItem.actor.add(switcherSettingsButton, { expand: false });
    
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
	sliderItem.actor.add(slider.actor, { expand: true });
	return sliderItem;
}

// shutdown the device
function powerOff() {
	Main.overview.hide();
	let session = new GnomeSession.SessionManager();
	session.ShutdownRemote(0);	// shutdown after 60s
	//Util.spawnCommandLine('poweroff');	// shutdown immediately
}

/* EXTENSION MAIN FUNCTIONS */
function init() {
    // initialize translations
    Convenience.initTranslations();

	// initialize timer and settings
	settings = Convenience.getSettings();
	timer = new Timer.Timer(powerOff);
}

function enable() {
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
	
	// handlers for changed values in settings
	settings.connect('changed::max-timer-value', _onSettingsChanged);
	settings.connect('changed::slider-value', _onSettingsChanged);
	settings.connect('changed::root-mode-value', _onSettingsChanged);
}

function disable() {
	timer.stopTimer(); // removes timer from Mainloop
	submenu.destroy(); // destroys switcher and sliderItem as children too
	separator.destroy();
}

