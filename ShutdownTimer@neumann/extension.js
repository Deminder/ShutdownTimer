/**
	AUTHOR: Daniel Neumann
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

// import own scripts
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Config = Extension.imports.config;
const Timer = Extension.imports.timer;

/* GLOBAL VARIABLES */
let textbox, submenu, slider, switcher, separator, config, timer;

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
		               time: 2,
		               transition: 'easeOutQuad',
		               onComplete: _hideTextbox });
}

function _hideTextbox() {
	Main.uiGroup.remove_actor(textbox);
	textbox = null;
}

// update timer value if slider has changed
function _onSliderChanged() {
	timer.timerValue = Math.floor(slider.value * config.maxTimerValue);
	switcher.label.text = timer.timerValue.toString() + ' min';
}

// toggle button starts/stops shutdown timer
function _onToggle() {
	if(switcher.state) {
		timer.startTimer();
		_showTextbox('System will shutdown in ' + timer.timerValue.toString() + ' minutes');
	} else {
		timer.stopTimer();
		_showTextbox('Shutdown Timer stopped');
		submenu.label.text = 'Shutdown Timer';
	}
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
	// initialize timer and config
	config = new Config.Config();
	timer = new Timer.Timer(Math.floor(config.sliderDefaultValue * config.maxTimerValue), powerOff);

	// submenu in status area menu with slider and toggle button
	let sliderItem = new PopupMenu.PopupMenuItem('');
	let sliderIcon = new St.Icon({ icon_name: 'preferences-system-time-symbolic', style_class: 'popup-menu-icon' });
	sliderItem.actor.add(sliderIcon);
	slider = new Slider.Slider(config.sliderDefaultValue);
	slider.connect('value-changed', _onSliderChanged);
	sliderItem.actor.add(slider.actor, { expand: true });

	switcher = new PopupMenu.PopupSwitchMenuItem('');
	switcher.label.text = timer.timerValue.toString() + ' min';
	switcher.connect('toggled', _onToggle);
	
	submenu = new PopupMenu.PopupSubMenuMenuItem('Shutdown Timer', true);
	submenu.icon.icon_name = 'system-shutdown-symbolic';
	submenu.menu.addMenuItem(switcher);
	submenu.menu.addMenuItem(sliderItem);
	timer.setMenuLabel(submenu.label);

	separator = new PopupMenu.PopupSeparatorMenuItem();
}

function enable() {
	// add separator line and submenu in status area menu
	let statusMenu = Main.panel.statusArea['aggregateMenu'];
	statusMenu.menu.addMenuItem(separator);
	statusMenu.menu.addMenuItem(submenu);
}

function disable() {
	timer.stopTimer(); // removes timer from Mainloop
	submenu.destroy(); // destroys switcher and sliderItem as children too
	separator.destroy();
	init();
}
