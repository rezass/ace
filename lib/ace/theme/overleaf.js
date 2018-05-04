define(function(require, exports, module) {
"use strict";

exports.isDark = false;
exports.cssClass = "ace-overleaf";
exports.cssText = require("../requirejs/text!./overleaf.css");
exports.$id = "ace/theme/overleaf";

var dom = require("../lib/dom");
dom.importCssString(exports.cssText, exports.cssClass);
});
