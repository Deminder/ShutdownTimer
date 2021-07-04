/**
    AUTHOR: Deminder
**/

let debugMode = true;

function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}
