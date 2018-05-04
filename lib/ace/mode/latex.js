define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var LatexHighlightRules = require("./latex_highlight_rules").LatexHighlightRules;
var LatexFoldMode = require("./folding/latex").FoldMode;
var Range = require("../range").Range;
var WorkerClient = require("ace/worker/worker_client").WorkerClient;
var LatexBehaviour = require("./behaviour/latex").LatexBehaviour;

var createLatexWorker = function (session) {
    var doc = session.getDocument();
    var selection = session.getSelection();
    var cursorAnchor = selection.lead;

    var savedRange = {};
    var suppressions = [];
    var hints = [];
    var changeHandler = null;
    var docChangePending = false;
    var firstPass = true;

    var worker = new WorkerClient(["ace"], "ace/mode/latex_worker", "LatexWorker");
    worker.attachToDocument(doc);

    // Handle cursor updates and document changes
    var docChangeHandler = doc.on("change", function () {
        docChangePending = true;
        if(changeHandler) {
            clearTimeout(changeHandler);
            changeHandler = null;
        }
    });

    // When a character is inserted/deleted we first get a
    // changeCursor event and then an doc change event.
    //
    // If we have errors that are not being shown, due to the cursor
    // being at the end of them we want to update the marker display
    // if the cursor moves.  We set a short timeout on the
    // changeCursor event and clear it on the doc change event, to
    // avoid doing extra work if the cursor move was from a change to
    // the document.

    var cursorHandler = selection.on("changeCursor", function () {
        if (docChangePending) { return; } ;
        changeHandler = setTimeout(function () {
            updateMarkers({cursorMoveOnly:true});
            suppressions = [];
            changeHandler = null;
        }, 100);
    });

    // Iterate through the list of hints and find new/removed ones,
    // updating the highlight markers accordingly.

    var updateMarkers = function (options) {
        if (!options) { options = {};};
        var cursorMoveOnly = options.cursorMoveOnly;
        var annotations = [];
        var newRange = {};
        var cursor = selection.getCursor();
        // Add a check for the cursor being at the end of the document
        var maxRow = session.getLength() - 1;
        var maxCol = (maxRow > 0) ? session.getLine(maxRow).length : 0;
        var cursorAtEndOfDocument = (cursor.row == maxRow) && (cursor.column === maxCol);

        suppressions = [];

        for (var i = 0, len = hints.length; i<len; i++) {
            var hint = hints[i];

            var suppressedChanges = 0;
            var hintRange = new Range(hint.start_row, hint.start_col, hint.end_row, hint.end_col);

            var cursorInRange = hintRange.insideEnd(cursor.row, cursor.column);
            var cursorAtStart = hintRange.isStart(cursor.row, cursor.column - 1); // cursor after start not before
            var cursorAtEnd = hintRange.isEnd(cursor.row, cursor.column);

            // If the user is editing at the beginning or end of this error, suppress it from display
            if (hint.suppressIfEditing && (cursorAtStart || cursorAtEnd)) {
                suppressions.push(hintRange);
                if (!hint.suppressed) { suppressedChanges++; };
                hint.suppressed = true;
                continue;
            }

            // Otherwise, check if this error starts inside a
            // suppressed error range (it's probably a cascading
            // error, so we hide it while the user is typing)
            var isCascadeError = false;
            for (var j = 0, suplen = suppressions.length; j < suplen; j++) {
                var badRange = suppressions[j];
                if (badRange.intersects(hintRange)) {
                    isCascadeError = true;
                    break;
                }
            }
            // Hide cascade errors
            if(isCascadeError) {
                if (!hint.suppressed) { suppressedChanges++; };
                hint.suppressed = true;
                continue;
            };

            if (hint.suppressed) { suppressedChanges++; };
            hint.suppressed = false;

            annotations.push(hint);

            // Hide info markers, display as annotations only
            if (hint.type === "info") {
                continue;
            };

            // Otherwise add to list of errors to display, use (start,end) as the identifier
            var key = hintRange.toString() + (cursorInRange ? "+cursor" : "");
            newRange[key] = {hint: hint, cursorInRange: cursorInRange, range: hintRange};
        }

        // Compare the errors to display with the currently displayed errors

        // Add markers for any new errors
        for (key in newRange) {
            if (!savedRange[key]) {  // doesn't exist in already displayed errors
                var new_range = newRange[key].range;
                cursorInRange = newRange[key].cursorInRange;
                hint = newRange[key].hint;
                // We make the highlight dynamic if we are inside the range
                //
                // If the cause of the error is at the beginning, we
                // move the end of the range with the cursor.
                //
                // If the cause of the error is at the end, and we
                // have gone back inside the range, we move the beginning of
                // the range with the cursor.
                //
                // If we're at the end of the document we always use a
                // static range and just update it on future lint
                // runs, as the behaviour of dynamic ranges doesn't
                // always give intuitive results at the end of the
                // document.
                var errorAtStart = (hint.row === hint.start_row && hint.column === hint.start_col);
                var movableStart = (cursorInRange && !errorAtStart) && !cursorAtEndOfDocument;
                var movableEnd = (cursorInRange && errorAtStart) && !cursorAtEndOfDocument;
                var a = movableStart ? cursorAnchor : doc.createAnchor(new_range.start);
                var b = movableEnd ? cursorAnchor : doc.createAnchor(new_range.end);
                var range = new Range();
                range.start = a;
                range.end = b;
                var cssClass = "ace_error-marker";
                if (hint.type === "warning") { cssClass = "ace_highlight-marker"; };
                range.id = session.addMarker(range, cssClass, "text");
                savedRange[key] = range;
            }
        }

        // Remove markers for any errors no longer present
        for (key in savedRange) {
            if (!newRange[key]) {  // no longer present in list of errors to display
                range = savedRange[key];
                if (range.start !== cursorAnchor) { range.start.detach(); }
                if (range.end !== cursorAnchor) { range.end.detach(); }
                session.removeMarker(range.id);
                delete savedRange[key];
            }
        }

        // If there were changes, also update the annotations in the margin
        if (!cursorMoveOnly || suppressedChanges) {
            if (firstPass) {
                if (annotations.length > 0) {
                    var originalAnnotations = session.getAnnotations();
                    session.setAnnotations(originalAnnotations.concat(annotations));
                };
                firstPass = false;
            } else {
                session.setAnnotations(annotations);
            }
        };

    };

    // Handler for results from the syntax validator
    worker.on("lint", function(results) {
        if(docChangePending) { docChangePending = false; };
        hints = results.data.errors;
        if (hints.length > 100) {
            hints = hints.slice(0, 100); // limit to 100 errors
        };
        updateMarkers();
    });

    // Clear ranges from editor on exit
    worker.on("terminate", function() {
        if(changeHandler) {
            clearTimeout(changeHandler);
            changeHandler = null;
        }
        // remove change handlers
        doc.off("change", docChangeHandler);
        selection.off("changeCursor", cursorHandler);
        // clear all existing highlights
        for (var key in savedRange) {
            var range = savedRange[key];
            if (range.start !== cursorAnchor) { range.start.detach(); }
            if (range.end !== cursorAnchor) { range.end.detach(); }
            session.removeMarker(range.id);
        }
        savedRange = {};
        hints = [];
        suppressions = [];
        session.clearAnnotations();
    });

    return worker;
};

var Mode = function() {
    this.HighlightRules = LatexHighlightRules;
    this.foldingRules = new LatexFoldMode();
    this.$behaviour = new LatexBehaviour();
    this.createWorker = createLatexWorker;
};
oop.inherits(Mode, TextMode);

(function() {
    this.type = "text";

    this.lineCommentStart = "%";

    this.$id = "ace/mode/latex";
}).call(Mode.prototype);

exports.Mode = Mode;

});
