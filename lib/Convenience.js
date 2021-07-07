/**
    AUTHOR: Deminder
**/

let debugMode = false;

function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}
