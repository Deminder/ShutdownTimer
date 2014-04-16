/**
	AUTHOR: Daniel Neumann
**/

const Lang = imports.lang;

/* CONFIG */
const Config = new Lang.Class({
	Name: 'Config',
	
	maxTimerValue:	180,		// maximum selectable time (in minutes)
	
	sliderDefaultValue: 0.4,	// must be in range 0.0 and 1.0
});
