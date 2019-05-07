/* ***** BEGIN LICENSE BLOCK *****
 *
 * Copyright (c) 2016 ShareLaTeX
 * All rights reserved.
 *
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var Mirror = require("../worker/mirror").Mirror;

var LatexWorker = exports.LatexWorker = function(sender) {
    Mirror.call(this, sender);
    this.setTimeout(250);
};

oop.inherits(LatexWorker, Mirror);

(function() {
    var disabled = false;
    this.onUpdate = function() {
        // bail out if we encounter any problems
        if (disabled) { return ; };

        var value = this.doc.getValue();
        var errors = [];
        var contexts = [];
        try {
            if (value) {
                var result = Parse(value);
                errors = result.errors;
                contexts = result.contexts;
            }
        } catch (e) {
            console.log(e);
            // suppress any further exceptions
            disabled = true;
            this.sender.emit("fatal-error", e);
            errors = [];
        }
        this.sender.emit("lint", {
          errors: errors,
          contexts: contexts
        });
    };

}).call(LatexWorker.prototype);

    // BEGIN PARSER

var Tokenise = function (text) {
    var Tokens = [];
    var Comments = [];
    var pos = -1;
    var SPECIAL = /[\\\{\}\$\&\#\^\_\~\%]/g;  // match TeX special characters
    var NEXTCS = /[^a-zA-Z]/g;  // match characters which aren't part of a TeX control sequence
    var idx = 0;

    var lineNumber = 0;   // current line number when parsing tokens (zero-based)
    var linePosition = [];  // mapping from line number to absolute offset of line in text[]
    linePosition[0] = 0;

    var checkingDisabled = false;
    var count = 0;  // number of tokens parses
    var MAX_TOKENS = 100000;

    // Main parsing loop, split into tokens on TeX special characters
    // each token is pushed onto the Tokens array as follows
    //
    // special character: [lineNumber, charCode, start]
    // control sequence:  [lineNumber, "\", start, end, "foo"]
    // control symbold:   [lineNumber, "\", start, end, "@"]
    //
    // end position = (position of last character in the sequence) + 1
    //
    // so text.substring(start,end) returns the "foo" for \foo

    while (true) {
        count++;

        // Avoid infinite loops and excessively large documents
        if (count > MAX_TOKENS) {
            throw new Error("exceed max token count of " + MAX_TOKENS);
            break;
        };
        var result = SPECIAL.exec(text);

        // If no more special characters found, must be text at end of file
        if (result == null) {
            if (idx < text.length) {
                Tokens.push([lineNumber, "Text", idx, text.length]);
                // FIXME: could check if previous token was Text and merge
            }
            break;
        }

        // Break out of loop if not going forwards in the file (shouldn't happen)
        if (result && result.index <= pos) {
            throw new Error("infinite loop in parsing");
            break;
        };


        // Move up to the position of the match
        pos = result.index;

        // Anything between special characters is text
        if (pos > idx) {
            // FIXME: check if previous token was Text and merge
            Tokens.push([lineNumber, "Text", idx, pos]);
        }

        // Scan over the text and update the line count
        for (var i = idx; i < pos; i++) {
            if (text[i] === "\n") {
                lineNumber++;
                linePosition[lineNumber] = i+1;
            }
        }

        var newIdx = SPECIAL.lastIndex;
        idx = newIdx;

        // Inspect the special character and consume additional characters according to TeX rules
        var code = result[0];
        if (code === "%") { // comment character
            // Handle comments by consuming up to the next newline character
            var newLinePos = text.indexOf("\n", idx);
            if (newLinePos === -1) {
                // reached end of file
                newLinePos = text.length;
            };
            // Check comment for our magic sequences %novalidate, %begin/%end novalidate
            var commentString = text.substring(idx, newLinePos);
            if (commentString.indexOf("%novalidate") === 0) {
                return [];
            } else if(!checkingDisabled && commentString.indexOf("%begin novalidate") === 0) {
                checkingDisabled = true;
            } else if (checkingDisabled && commentString.indexOf("%end novalidate") === 0) {
                checkingDisabled = false;
            };
            // Update the line count
            idx = SPECIAL.lastIndex = newLinePos + 1;
            Comments.push([lineNumber, idx, newLinePos]);
            lineNumber++;
            linePosition[lineNumber] = idx;
        } else if (checkingDisabled) {
            // do nothing
            continue;
        } else if (code === '\\') { // escape character
            // Handle TeX control sequences (\foo) and control symbols (\@)
            // Look ahead to find the next character not valid in a control sequence [^a-zA-Z]
            NEXTCS.lastIndex = idx;
            var controlSequence = NEXTCS.exec(text);
            var nextSpecialPos = controlSequence === null ? idx : controlSequence.index;
            if (nextSpecialPos === idx) {
                // it's a control symbol
                Tokens.push([lineNumber, code, pos, idx + 1, text[idx], "control-symbol"]);
                idx = SPECIAL.lastIndex = idx + 1;
                char = text[nextSpecialPos];
                // update the line number if someone typed \ at the end of a line
                if (char === '\n') { lineNumber++; linePosition[lineNumber] = nextSpecialPos;};
            } else {
                // it's a control sequence
                Tokens.push([lineNumber, code, pos, nextSpecialPos, text.slice(idx, nextSpecialPos)]);
                // consume whitespace after a control sequence (update the line number too)
                var char;
                while ((char = text[nextSpecialPos]) === ' ' || char === '\t' || char  === '\r' || char === '\n') {
                    nextSpecialPos++;
                    if (char === '\n') { lineNumber++; linePosition[lineNumber] = nextSpecialPos;};
                }
                idx = SPECIAL.lastIndex = nextSpecialPos;
            }
        } else if (["{", "}", "$", "&", "#", "^", "_", "~"].indexOf(code) > -1) {  // special characters
            Tokens.push([lineNumber, code, pos, pos+1]);
        } else {
            throw "unrecognised character " + code;
        }
    }

    return {tokens: Tokens, comments: Comments, linePosition: linePosition, lineNumber: lineNumber, text: text};
};

// Functions for consuming TeX arguments

var read1arg = function (TokeniseResult, k, options) {
    // read an argument FOO to a either form of command
    // \newcommand\FOO...
    // \newcommand{\FOO}...
    // Also support \newcommand*
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    // check for optional * like \newcommand*
    if (options && options.allowStar) {
        var optional = Tokens[k+1];
        if (optional && optional[1] === "Text") {
            var optionalstr = text.substring(optional[2], optional[3]);
            if (optionalstr === "*") { k++;}
        };
    };

    var open = Tokens[k+1];
    var delimiter = Tokens[k+2];
    var close = Tokens[k+3];
    var delimiterName;

    if(open && open[1] === "\\") {
        // plain \FOO, isn't enclosed in braces
        delimiterName = open[4]; // array element 4 is command sequence
        return k + 1;
    } else if(open && open[1] === "{" && delimiter && delimiter[1] === "\\" && close && close[1] === "}") {
        // argument is in braces
        delimiterName = delimiter[4]; // NOTE: if we were actually using this, keep track of * above
        return k + 3; // array element 4 is command sequence
    } else {
        // couldn't find argument
        return null;
    }
};

var readLetDefinition = function (TokeniseResult, k) {
    // read a let command  (the equals sign is optional)
    // \let\foo=\bar
    // \let\foo=TOKEN
    // \let\foo\bar
    // \let\foo\TOKEN

    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var first = Tokens[k+1];
    var second = Tokens[k+2];
    var third = Tokens[k+3];

    if(first && first[1] === "\\" && second && second[1] === "\\") {
        return k + 2;
    } else if(first && first[1] === "\\" &&
              second && second[1] === "Text" && text.substring(second[2], second[3]) === "=" &&
              third && third[1] === "\\") {
        return k + 3;
    } else {
        // couldn't find argument
        return null;
    }
};

var read1name = function (TokeniseResult, k) {
    // read an environemt name FOO in
    // \newenvironment{FOO}...
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var open = Tokens[k+1];
    var delimiter = Tokens[k+2];
    var close = Tokens[k+3];

    if(open && open[1] === "{" && delimiter && delimiter[1] === "Text" && close && close[1] === "}") {
        var delimiterName = text.substring(delimiter[2], delimiter[3]);
        return k + 3;
    } else if (open && open[1] === "{" && delimiter && delimiter[1] === "Text") {
        // handle names like FOO_BAR
        delimiterName = "";
        for (var j = k + 2, tok; (tok = Tokens[j]); j++) {
            if (tok[1] === "Text") {
                var str = text.substring(tok[2], tok[3]);
                if (!str.match(/^\S*$/)) { break; }
                delimiterName = delimiterName + str;
            } else if (tok[1] === "_") {
                delimiterName = delimiterName + "_";
            } else {
                break;
            }
        }
        if (tok && tok[1] === "}") {
            return  j; // advance past these tokens
        } else {
            return null;
        }
    } else {
        // couldn't find environment name
        return null;
    }
};

var read1filename = function (TokeniseResult, k) {
    // read an filename foo_bar.tex
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var fileName = "";
    for (var j = k + 1, tok; (tok = Tokens[j]); j++) {
        if (tok[1] === "Text") {
            var str = text.substring(tok[2], tok[3]);
            if (!str.match(/^\S*$/)) { break; }
            fileName = fileName + str;
        } else if (tok[1] === "_") {
            fileName = fileName + "_";
        } else {
            break;
        }
    }
    if (fileName.length > 0) {
        return  j; // advance past these tokens
    } else {
        return null;
    }
};

var readOptionalParams = function(TokeniseResult, k) {
    // read an optional parameter [N] where N is a number, used
    // for \newcommand{\foo}[2]... meaning 2 parameters
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var params = Tokens[k+1];

    // Quick check for arguments like [1][key=value,key=value]
    if(params && params[1] === "Text") {
        var paramNum = text.substring(params[2], params[3]);
        if (paramNum.match(/^\[\d+\](\[[^\]]*\])*\s*$/)) {
            return k + 1; // got it
        };
    };


    // Skip over arbitrary arguments [xxx][yyy][\foo{zzz}]{... up to the first {..
    var count = 0;
    var nextToken = Tokens[k+1];
    if (!nextToken) { return null };
    var pos = nextToken[2];

    for (var i = pos, end = text.length; i < end; i++) {
        var char = text[i];
        if (nextToken && i >= nextToken[2]) { k++; nextToken = Tokens[k+1];};
        if (char === "[") { count++; }
        if (char === "]") { count--; }
        if (count === 0 && char === "{") { return k - 1; }
        if (count > 0 && (char  === '\r' || char === '\n')) { return null; }
    };

    // can't find an optional parameter
    return null;
};

var readOptionalGeneric = function(TokeniseResult, k) {
    // read an optional parameter [foo]
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var params = Tokens[k+1];

    if(params && params[1] === "Text") {
        var paramNum = text.substring(params[2], params[3]);
        if (paramNum.match(/^(\[[^\]]*\])+\s*$/)) {
            return k + 1; // got it
        };
    };

    // can't find an optional parameter
    return null;
};

var readOptionalStar = function(TokeniseResult, k) {
  // read an optional *
  var Tokens = TokeniseResult.tokens;
  var text = TokeniseResult.text;

  var params = Tokens[k + 1];

  if (params && params[1] === "Text") {
    var paramNum = text.substring(params[2], params[3]);
    if (paramNum.match(/^(\*)+\s*$/)) {
      return k + 1; // got it
    }
  }

  // can't find an optional *
  return null;
};

var readOptionalDef = function (TokeniseResult, k) {
    // skip over the optional arguments of a definition
    // \def\foo#1.#2(#3){this is the macro #1 #2 #3}
    // start looking at text immediately after \def command
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var defToken = Tokens[k];
    var pos = defToken[3];

    var openBrace = "{";
    var nextToken = Tokens[k+1];
    for (var i = pos, end = text.length; i < end; i++) {
        var char = text[i];
        if (nextToken && i >= nextToken[2]) { k++; nextToken = Tokens[k+1];};
        if (char === openBrace) { return k - 1; }; // move back to the last token of the optional arguments
        if (char  === '\r' || char === '\n') { return null; }
    };

    return null;

};

var readDefinition = function(TokeniseResult, k) {
    // read a definition as in
    // \newcommand{\FOO}{DEFN}
    // \newcommand{\FOO}   {DEF}  (optional whitespace)
    // look ahead for argument, consuming whitespace
    // the definition is read looking for balanced { } braces.
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    k = k + 1;
    var count = 0;
    var nextToken = Tokens[k];
    while (nextToken && nextToken[1] === "Text") {
        var start = nextToken[2], end = nextToken[3];
        for (var i = start; i < end; i++) {
            var char = text[i];
            if (char === ' ' || char === '\t' || char  === '\r' || char === '\n') { continue; }
            return null; // bail out, should begin with a {
        }
        k++;
        nextToken = Tokens[k];
    }

    // Now we're at the start of the actual argument
    if (nextToken && nextToken[1] === "{") {
        count++;
        // use simple bracket matching { } to find where the
        // argument ends
        while (count>0) {
            k++;
            nextToken = Tokens[k];
            if(!nextToken) { break; };
            if (nextToken[1] === "}") { count--; }
            if (nextToken[1] === "{") { count++; }
        }
        return k;
    }

    return null;
};

var readVerb = function(TokeniseResult, k) {
    // read a verbatim argument
    // \verb@foo@
    // \verb*@foo@
    // where @ is any character except * for \verb
    // foo is any sequence excluding end-of-line and the delimiter
    // a space does work for @, contrary to latex documentation

    // Note: this is only an approximation, because we have already
    // tokenised the input stream, and we should really do that taking
    // into account the effect of verb.  For example \verb|%| will get
    // confused because % is then a character.

    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var verbToken = Tokens[k];
    var verbStr = text.substring(verbToken[2], verbToken[3]);

    // start looking at text immediately after \verb command
    var pos = verbToken[3];
    if (text[pos] === "*") { pos++; } // \verb* form of command
    var delimiter = text[pos];
    pos++;

    var nextToken = Tokens[k+1];
    for (var i = pos, end = text.length; i < end; i++) {
        var char = text[i];
        if (nextToken && i >= nextToken[2]) { k++; nextToken = Tokens[k+1];};
        if (char === delimiter) { return k; };
        if (char  === '\r' || char === '\n') { return null; }
    };

    return null;
};

var readUrl = function(TokeniseResult, k) {
    // read a url argument
    // \url|foo|
    // \url{foo}

    // Note: this is only an approximation, because we have already
    // tokenised the input stream, so anything after a comment
    // character % on the current line will not be present in the
    // input stream.

    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var urlToken = Tokens[k];
    var urlStr = text.substring(urlToken[2], urlToken[3]);

    // start looking at text immediately after \url command
    var pos = urlToken[3];
    var openDelimiter = text[pos];
    var closeDelimiter =  (openDelimiter === "{") ? "}" : openDelimiter;

    // Was the delimiter a token? if so, advance token index
    var nextToken = Tokens[k+1];
    if (nextToken && pos === nextToken[2]) {
        k++;
        nextToken = Tokens[k+1];
    };

    // Now start looking at the enclosed text
    pos++;

    var count = 1;
    for (var i = pos, end = text.length; count > 0 && i < end; i++) {
        var char = text[i];
        if (nextToken && i >= nextToken[2]) { k++; nextToken = Tokens[k+1];};
        if (char === closeDelimiter) {
            count--;
        } else if (char === openDelimiter) {
            count++;
        };
        if (count === 0) { return k; };
        if (char  === '\r' || char === '\n') { return null; }
    };

    return null;
};

var InterpretTokens = function (TokeniseResult, ErrorReporter) {
    var Tokens = TokeniseResult.tokens;
    var linePosition = TokeniseResult.linePosition;
    var lineNumber = TokeniseResult.lineNumber;
    var text = TokeniseResult.text;

    var TokenErrorFromTo = ErrorReporter.TokenErrorFromTo;
    var TokenError = ErrorReporter.TokenError;
    var Environments = new EnvHandler(TokeniseResult, ErrorReporter);

    var nextGroupMathMode = null; // if the next group should have
                                  // math mode on(=true) or
                                  // off(=false) (for \hbox), or
                                  // unknown(=undefined) or inherit
                                  // the current math mode from the
                                  // parent environment(=null)
    var nextGroupMathModeStack = [] ; // tracking all nextGroupMathModes
    var seenUserDefinedBeginEquation = false; // if we have seen macros like \beq
    var seenUserDefinedEndEquation = false; // if we have seen macros like \eeq

    // Iterate over the tokens, looking for environments to match
    //
    // Push environment command found (\begin, \end) onto the
    // Environments array.

    for (var i = 0, len = Tokens.length; i < len; i++) {
        var token = Tokens[i];
        var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];

        if (type === "{") {
            // handle open group as a type of environment
            Environments.push({command:"{", token:token, mathMode: nextGroupMathMode});
            // if previously encountered a macro with a known or
            // unknow math mode set that, and put it on a stack to be
            // used for subsequent arguments \foo{...}{...}{...}
            nextGroupMathModeStack.push(nextGroupMathMode);
            nextGroupMathMode = null;
            continue;
        } else if (type === "}") {
            // handle close group as a type of environment
            Environments.push({command:"}", token:token});
            // retrieve the math mode of the current macro (if any)
            // for subsequent arguments
            nextGroupMathMode = nextGroupMathModeStack.pop();
            continue;
        } else {
            // we aren't opening or closing a group, so reset the
            // nextGroupMathMode - the next group will not be in math
            // mode or undefined unless otherwise specified below
            nextGroupMathMode = null;
        };

        if (type === "\\") {
            // Interpret each control sequence
            if (seq === "begin" || seq === "end") {
                // We've got a begin or end, now look ahead at the
                // next three tokens which should be "{" "ENVNAME" "}"
                var open = Tokens[i+1];
                var delimiter = Tokens[i+2];
                var close = Tokens[i+3];
                if(open && open[1] === "{" && delimiter && delimiter[1] === "Text" && close && close[1] === "}") {
                    // We've got a valid environment command, push it onto the array.
                    var delimiterName = text.substring(delimiter[2], delimiter[3]);
                    Environments.push({command: seq, name: delimiterName, token: token, closeToken: close});
                    i = i + 3; // advance past these tokens
                } else {
                    // Check for an environment command like \begin{new_major_theorem}
                    if (open && open[1] === "{" && delimiter && delimiter[1] === "Text") {
                        delimiterName = "";
                        for (var j = i + 2, tok; (tok = Tokens[j]); j++) {
                            if (tok[1] === "Text") {
                                var str = text.substring(tok[2], tok[3]);
                                if (!str.match(/^\S*$/)) { break; }
                                delimiterName = delimiterName + str;
                            } else if (tok[1] === "_") {
                                delimiterName = delimiterName + "_";
                            } else {
                                break;
                            }
                        }
                        if (tok && tok[1] === "}") {
                            Environments.push({command: seq, name: delimiterName, token: token, closeToken: close});
                            i = j; // advance past these tokens
                            continue;
                        }
                    }

                    // We're looking at an invalid environment command, read as far as we can in the sequence
                    // "{" "CHAR" "CHAR" "CHAR" ... to report an error for as much of the command as we can,
                    // bail out when we hit a space/newline.
                    var endToken = null;
                    if (open && open[1] === "{") {
                        endToken = open; // we've got a {
                        if (delimiter && delimiter[1] === "Text") {
                            endToken = delimiter.slice(); // we've got some text following the {
                            start = endToken[2]; end = endToken[3];
                            for (j = start; j < end; j++) {
                                var char = text[j];
                                if (char === ' ' || char === '\t' || char  === '\r' || char === '\n') { break; }
                            }
                            endToken[3] = j; // the end of partial token is as far as we got looking ahead
                        };
                    };

                    if (endToken) {
                        TokenErrorFromTo(token, endToken, "invalid environment command " + text.substring(token[2], endToken[3] || endToken[2]));
                    } else {
                        TokenError(token, "invalid environment command");
                    };
                }
            } else if (typeof seq === "string" && seq.match(/^(be|beq|beqa|bea)$/i)) {
                //Environments.push({command: "begin", name: "user-defined-equation", token: token});
                seenUserDefinedBeginEquation = true;
            } else if (typeof seq === "string" && seq.match(/^(ee|eeq|eeqn|eeqa|eeqan|eea)$/i)) {
                //Environments.push({command: "end", name: "user-defined-equation", token: token});
                seenUserDefinedEndEquation = true;
            } else if (seq === "newcommand" || seq === "renewcommand" || seq === "DeclareRobustCommand") {
                // Parse command definitions in a limited way, to
                // avoid falsely reporting errors from unmatched
                // environments in the command definition
                //
                // e.g. \newcommand{\foo}{\begin{equation}} is valid
                // and should not trigger an "unmatch environment"
                // error

                // try to read first arg \newcommand{\foo}...., advance if found
                // and otherwise bail out
                var newPos = read1arg(TokeniseResult, i, {allowStar: true});
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalParams(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read command defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

            } else if (seq === "def") {
                // try to read first arg \def\foo...., advance if found
                // and otherwise bail out
                newPos = read1arg(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalDef(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read command defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

            } else if (seq === "let") {
                // Parse any \let commands  can be
                // \let\foo\bar
                // \let\foo=\bar
                // \let\foo=TOKEN
                newPos = readLetDefinition(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};

            } else if (seq === "newcolumntype") {
                // try to read first arg \newcolumntype{T}...., advance if found
                // and otherwise bail out
                newPos = read1name(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalParams(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read command defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

            } else if (seq === "newenvironment" || seq === "renewenvironment") {
                // Parse environment definitions in a limited way too
                // \newenvironment{name}[3]{open}{close}

                // try to read first arg \newcommand{\foo}...., advance if found
                // and otherwise bail out
                newPos = read1name(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalParams(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read open defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read close defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
            } else if (seq === "verb") {
                // \verb|....|  where | = any char
                newPos = readVerb(TokeniseResult, i);
                if (newPos === null) { TokenError(token, "invalid verbatim command"); } else {i = newPos;};
            } else if (seq === "url") {
                // \url{...} or \url|....|  where | = any char
                newPos = readUrl(TokeniseResult, i);
                if (newPos === null) { TokenError(token, "invalid url command"); } else {i = newPos;};
            } else if (seq === "left" || seq === "right") {
                // \left( and \right)
                var nextToken = Tokens[i+1];
                char = "";
                if (nextToken && nextToken[1] === "Text") {
                    char = text.substring(nextToken[2], nextToken[2] + 1);
                } else if (nextToken && nextToken[1] === "\\" && nextToken[5] == "control-symbol") {
                    // control symbol
                    char = nextToken[4];
                } else if (nextToken && nextToken[1] === "\\") {
                    char = "unknown";
                }
                if (char === "" || (char !== "unknown" && "(){}[]<>/|\\.".indexOf(char) === -1)) {
                    // unrecognized bracket  - list of allowed delimiters from TeX By Topic (38.3.2 Delimiter codes)
                    TokenError(token, "invalid bracket command");
                } else {
                    i = i + 1;
                    Environments.push({command:seq, token:token});
                };
            } else if (seq === "(" || seq === ")" || seq === "[" || seq === "]") {
                Environments.push({command:seq, token:token});
            } else if (seq === "input") {
                // skip over filenames, may contain _
                newPos = read1filename(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};
            } else if (seq === "hbox" || seq === "text" || seq === "mbox" || seq === "footnote" || seq === "intertext" || seq === "shortintertext" || seq === "textnormal" || seq === "reflectbox" || seq === "textrm") {
                // next group will be in text mode regardless
                nextGroupMathMode = false;
            } else if (seq === "tag") {
                // tag can take an optional star like \tag*{$math$}
                newPos = readOptionalStar(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
                nextGroupMathMode = false;
            } else if (seq === "rotatebox" || seq === "scalebox"  || seq == "feynmandiagram" || seq === "tikz") {
                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalGeneric(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
                // try to read parameter {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
                nextGroupMathMode = false;
            } else if (seq === "resizebox") {
                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalGeneric(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
                // try to read width parameter {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
                // try to read height parameter {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                nextGroupMathMode = false;
            } else if (seq === "DeclareMathOperator") {
                // try to read first arg {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read second arg {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
            } else if (seq === "DeclarePairedDelimiter") {
                // try to read first arg {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read second arg {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read third arg {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
            } else if (typeof seq === "string" && seq.match(/^(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/)) {
                var currentMathMode = Environments.getMathMode() ; // returns null / $(inline) / $$(display)
                if (currentMathMode === null) {
                    TokenError(token, type + seq + " must be inside math mode", {mathMode:true});
                };
            } else if (typeof seq === "string" && seq.match(/^(chapter|section|subsection|subsubsection)$/)) {
                currentMathMode = Environments.getMathMode() ; // returns null / $(inline) / $$(display)
                if (currentMathMode) {
                    TokenError(token, type + seq + " used inside math mode", {mathMode:true});
                    Environments.resetMathMode();
                };
            } else if (typeof seq === "string" && seq.match(/^[a-z]+$/)) {
                // if we see an unknown command \foo{...}{...} put the
                // math mode for the next group into the 'undefined'
                // state, because we do not know what math mode an
                // arbitrary macro will use for its arguments.  In the
                // math mode 'undefined' state we don't report errors
                // when we encounter math or text commands.
                nextGroupMathMode = undefined;
            };

        } else if (type === "$") {
            var lookAhead = Tokens[i+1];
            var nextIsDollar = lookAhead && lookAhead[1] === "$";
            currentMathMode = Environments.getMathMode() ; // returns null / $(inline) / $$(display)
            // If we have a $$ and we're not in displayMath, we go into that
            // If we have a $$ and with not in math mode at all, we got into displayMath
            if (nextIsDollar && (!currentMathMode || currentMathMode.command == "$$")) {
                if (currentMathMode && currentMathMode.command == "$$") {
                    // Use last $ as token if it's the end of math mode, so that we capture all content, including both $s
                    var delimiterToken = lookAhead;
                } else {
                    var delimiterToken = token;
                }
                Environments.push({command:"$$", token:delimiterToken});
                i = i + 1;
            } else {
                Environments.push({command:"$", token:token});
            }
        } else if (type === "^" || type === "_") {
            // check for mathmode ASSUMING environments are correct
            // if they aren't we'll catch it below
            // we can maybe set a flag here for math mode state?
            currentMathMode = Environments.getMathMode() ; // returns null / $(inline) / $$(display)
            // need to exclude cases like \cite{foo_bar} so ignore everything inside {...}
            var insideGroup = Environments.insideGroup();  // true if inside {....}
            if (currentMathMode === null && !insideGroup) {
                TokenError(token, type + " must be inside math mode", {mathMode:true});
            };
        }
    };

    if (seenUserDefinedBeginEquation && seenUserDefinedEndEquation) {
        // there are commands like \beq or \eeq which are typically
        // shortcuts for \begin{equation} and \end{equation}, so
        // disable math errors
        ErrorReporter.filterMath = true;
    };

    return Environments;
};

var DocumentTree = function(TokeniseResult) {
    // Each environment and scope becomes and an entry in the tree, and can have
    // child entries, e.g. an 'array' inside an 'equation' inside a 'document' environment.
    // Entries can have multiple adjacent children.
    var tree = {
      children: []
    };
    // The stack is just for easily moving up and down the tree. Popping off the stack
    // moves us back up the context of the current environment.
    var stack = [tree];
    
    this.openEnv = function(startDelimiter) {
        var currentNode = this.getCurrentNode();
        var newNode = {
            startDelimiter: startDelimiter,
            children: []
        };
        currentNode.children.push(newNode);
        stack.push(newNode);
    };
    
    this.closeEnv = function(endDelimiter) {
        if (stack.length == 1) {
            // Can't close root element
            return null
        }
        var currentNode = stack.pop();
        currentNode.endDelimiter = endDelimiter;
        return currentNode.startDelimiter;
    };
    
    this.getNthPreviousNode = function(n) {
        var offset = stack.length - n - 1;
        if (offset < 0)
            return null;
        return stack[offset];
    }
    
    this.getCurrentNode = function() {
        return this.getNthPreviousNode(0);
    }
    
    this.getCurrentDelimiter = function() {
        return this.getCurrentNode().startDelimiter;
    };

    this.getPreviousDelimiter = function() {
        var node = this.getNthPreviousNode(1);
        if (!node)
            return null
        return node.startDelimiter;
    }
    
    this.getDepth = function() {
        return (stack.length - 1) // Root node doesn't count
    }
    
    this.getContexts = function() {
        var linePosition = TokeniseResult.linePosition;

        function tokenToRange(token) {
            var line = token[0], start = token[2], end = token[3];
            var start_col = start - linePosition[line];
            if (!end) { end = start + 1; } ;
            var end_col = end - linePosition[line];
            return {
                start: {
                    row: line,
                    column: start_col
                },
                end: {
                    row: line,
                    column: end_col
                }
            }
        };
        
        function getContextsFromNode(node) {
            if (node.startDelimiter && node.startDelimiter.mathMode) {
                var context = {
                    type: "math",
                    range: {
                        start: tokenToRange(node.startDelimiter.token).start
                    }
                };
                if (node.endDelimiter) {
                    var closeToken = node.endDelimiter.closeToken || node.endDelimiter.token;
                    context.range.end = tokenToRange(closeToken).end;
                };
                return [context];
            } else {
                var contexts = [];
                for (var i = 0; i < node.children.length; i++) {
                    var child = node.children[i];
                    contexts = contexts.concat(getContextsFromNode(child));
                }
                return contexts;
            }
        };
        
        return getContextsFromNode(tree);
    }
}

var EnvHandler = function (TokeniseResult, ErrorReporter) {
    // Loop through the Environments array keeping track of the state,
    // pushing and popping environments onto the state[] array for each
    // \begin and \end command
    var ErrorTo = ErrorReporter.EnvErrorTo;
    var ErrorFromTo = ErrorReporter.EnvErrorFromTo;
    var ErrorFrom = ErrorReporter.EnvErrorFrom;

    var delimiters = [];

    var document = new DocumentTree(TokeniseResult);
    var documentClosed = null;
    var inVerbatim = false;
    var verbatimRanges = [];
    
    this.getDocument = function() {
        return document;
    };

    this.push = function (newDelimiter) {
        this.setDelimiterProps(newDelimiter);
        this.checkAndUpdateState(newDelimiter);
        delimiters.push(newDelimiter);
    };

    this._endVerbatim = function (thisDelimiter) {
        var lastDelimiter = document.getCurrentDelimiter();
        if (lastDelimiter && lastDelimiter.name === thisDelimiter.name) {
            // closed verbatim environment correctly
            inVerbatim = false;
            document.closeEnv(thisDelimiter);
            // keep track of all the verbatim ranges to filter out errors
            verbatimRanges.push({start: lastDelimiter.token[2], end: thisDelimiter.token[2]});
        }
    };

    var invalidEnvs = [];

    this._end = function (thisDelimiter) {
        // check if environment or group is closed correctly
        do {
            var lastDelimiter = document.getCurrentDelimiter();
            var retry = false;
            var i;

            if (closedBy(lastDelimiter, thisDelimiter)) {
                // closed correctly
                document.closeEnv(thisDelimiter);
                if (thisDelimiter.command === "end" && thisDelimiter.name === "document" && !documentClosed) {
                    documentClosed = thisDelimiter;
                };
                return;
            } else if (!lastDelimiter) {
                // unexpected close, nothing was open!
                if (documentClosed) {
                    ErrorFromTo(documentClosed, thisDelimiter, "\\end{" + documentClosed.name + "} is followed by unexpected content",{errorAtStart: true, type: "info"});
                } else {
                    ErrorTo(thisDelimiter, "unexpected " + getName(thisDelimiter));
                }
            } else if (invalidEnvs.length > 0 && (i = indexOfClosingEnvInArray(invalidEnvs, thisDelimiter) > -1)) {
                // got a match on an invalid env, so try to continue
                invalidEnvs.splice(i, 1);
                return;
            } else {
                var status = reportError(lastDelimiter, thisDelimiter);
                if (delimiterPrecedence(lastDelimiter) < delimiterPrecedence(thisDelimiter)) {
                    // discard the lastDelimiter then retry the match for thisDelimiter
                    document.closeEnv();
                    invalidEnvs.push(lastDelimiter);
                    retry = true;
                } else {
                    // tried to close a different environment for the one that is open
                    // Apply some heuristics to try to minimise cascading errors
                    //
                    // Consider cases of
                    // 1) Extra \end:      \begin{A}  \end{B}  \end{A}
                    // 2) Extra \begin:    \begin{A}  \begin{B} \end{A}
                    //
                    // Case (2) try looking back to the previous \begin,
                    // if it gives a valid match, take it!
                    var prevDelimiter = document.getPreviousDelimiter();
                    if(prevDelimiter) {
                        if (thisDelimiter.name === prevDelimiter.name) {
                            //  got a match on the previous environment
                            document.closeEnv() // Close current env
                            document.closeEnv(thisDelimiter) // Close previous env
                            return;
                        }
                    }
                    // No match so put lastDelimiter back on a list of valid
                    // environments that we might be able to match on
                    // further errors
                    invalidEnvs.push(lastDelimiter);
                }

            }
        } while (retry === true);
    };

    var CLOSING_DELIMITER = {
        "{" : "}",
        "left" : "right",
        "[" : "]",
        "(" : ")",
        "$" : "$",
        "$$": "$$"
    };

    var closedBy = function (lastDelimiter, thisDelimiter) {
        if (!lastDelimiter) {
            return false ;
        } else if (thisDelimiter.command === "end") {
            return lastDelimiter.command === "begin" && lastDelimiter.name === thisDelimiter.name;
        } else if (thisDelimiter.command === CLOSING_DELIMITER[lastDelimiter.command]) {
            return true;
        } else {
            return false;
        }
    };

    var indexOfClosingEnvInArray = function (delimiters, thisDelimiter) {
        for (var i = 0, n = delimiters.length; i < n ; i++) {
            if (closedBy(delimiters[i], thisDelimiter)) {
                return i;
            }
        }
        return -1;
    };

    var delimiterPrecedence = function (delimiter) {
        var openScore = {
            "{" : 1,
            "left" : 2,
            "$" : 3,
            "$$" : 4,
            "begin": 4
        };
        var closeScore = {
            "}" : 1,
            "right" : 2,
            "$" : 3,
            "$$" : 5,
            "end": 4
        };
        if (delimiter.command) {
            return openScore[delimiter.command] || closeScore[delimiter.command];
        } else {
            return 0;
        }
    };

    var getName = function(delimiter) {
        var description = {
            "{" : "open group {",
            "}" : "close group }",
            "[" : "open display math \\[",
            "]" : "close display math \\]",
            "(" : "open inline math \\(",
            ")" : "close inline math \\)",
            "$" : "$",
            "$$" : "$$",
            "left" : "\\left",
            "right" : "\\right"
        };
        if (delimiter.command === "begin" || delimiter.command === "end") {
            return "\\" + delimiter.command + "{" + delimiter.name + "}";
        } else if (delimiter.command in description) {
            return description[delimiter.command];
        } else {
            return delimiter.command;
        }
    };

    var EXTRA_CLOSE = 1;
    var UNCLOSED_GROUP = 2;
    var UNCLOSED_ENV = 3;

    var reportError = function(lastDelimiter, thisDelimiter) {
        if (!lastDelimiter) { // unexpected close, nothing was open!
            if (documentClosed) {
                ErrorFromTo(documentClosed, thisDelimiter, "\\end{" + documentClosed.name + "} is followed by unexpected end group }",{errorAtStart: true, type: "info"});
            } else {
                ErrorTo(thisDelimiter, "unexpected " + getName(thisDelimiter));
            };
            return EXTRA_CLOSE;
        } else if (lastDelimiter.command === "{" && thisDelimiter.command === "end") {
            ErrorFromTo(lastDelimiter, thisDelimiter, "unclosed " + getName(lastDelimiter) + " found at " + getName(thisDelimiter),
                        {suppressIfEditing:true, errorAtStart: true, type:"warning"});
            // discard the open group by not pushing it back on the stack
            return UNCLOSED_GROUP;
        } else {
            var pLast = delimiterPrecedence(lastDelimiter);
            var pThis = delimiterPrecedence(thisDelimiter);
            if (pThis > pLast) {
                ErrorFromTo(lastDelimiter, thisDelimiter, "unclosed " + getName(lastDelimiter) + " found at " + getName(thisDelimiter),
                           {suppressIfEditing:true, errorAtStart: true});
            } else {
                ErrorFromTo(lastDelimiter, thisDelimiter, "unexpected " + getName(thisDelimiter) + " after " + getName(lastDelimiter));
            }
            return UNCLOSED_ENV;
        };
    };

    this._beginMathMode = function (thisDelimiter) {
        // start a new math environment
        var currentMathMode = this.getMathMode(); // undefined, null, $, $$, name of mathmode env
        if (currentMathMode) {
            ErrorFrom(thisDelimiter, getName(thisDelimiter) + " used inside existing math mode " + getName(currentMathMode),
                      {suppressIfEditing:true, errorAtStart: true, mathMode:true});
        };
        thisDelimiter.mathMode = thisDelimiter;
        document.openEnv(thisDelimiter);
    };

    this._toggleMathMode = function (thisDelimiter) {
        // math environments use the same for begin and end.
        var lastDelimiter = document.getCurrentDelimiter();
        if (closedBy(lastDelimiter, thisDelimiter)) {
            // closed math environment correctly
            document.closeEnv(thisDelimiter)
            return;
        } else {
            if (lastDelimiter && lastDelimiter.mathMode) {
                // already in math mode
                this._end(thisDelimiter);
            } else {
                // start a new math environment
                thisDelimiter.mathMode = thisDelimiter;
                document.openEnv(thisDelimiter);
            }
        };
    };

    this.getMathMode = function () {
        // return the current mathmode.
        // the mathmode is an object, it is the environment that opened the math mode
        var currentDelimiter = document.getCurrentDelimiter();
        if (currentDelimiter) {
            return currentDelimiter.mathMode;
        } else {
            return null;
        }
    };

    this.insideGroup = function () {
        var currentDelimiter = document.getCurrentDelimiter();
        if (currentDelimiter) {
            return (currentDelimiter.command === "{");
        } else {
            return null;
        }
    };

    var resetMathMode = function () {
        // Wind back the current environment stack removing everything
        // from the start of the current math mode
        var currentDelimiter = document.getCurrentDelimiter();
        if (currentDelimiter) {
            var lastMathMode = currentDelimiter.mathMode;
            do {
                var lastDelimiter = document.closeEnv();
            } while (lastDelimiter && lastDelimiter !== lastMathMode);
        } else {
            return;
        }
    };

    this.resetMathMode = resetMathMode;

    var getNewMathMode = function (currentMathMode, thisDelimiter) {
        // look at math mode and transitions
        //
        // We have several cases
        //
        // 1. environments that can only be used outside math mode (document, quote, etc)
        // 2. environments that can only be used inside math mode (array)
        // 3. environments that start math mode (equation)
        // 4. environments that are unknown (new_theorem)
        var newMathMode = null;

        if (thisDelimiter.command === "{") {
            if (thisDelimiter.mathMode !== null) {
                // the group is a special one with a definite mathmode e.g. \hbox
                newMathMode = thisDelimiter.mathMode;
            } else {
                newMathMode = currentMathMode;
            }
        } else if (thisDelimiter.command === "left") {
            if (currentMathMode === null) {
                ErrorFrom(thisDelimiter, "\\left can only be used in math mode", {mathMode: true});
            };
            newMathMode = currentMathMode;
        } else if (thisDelimiter.command === "begin") {
            var name = thisDelimiter.name;
            if (name) {
                if (name.match(/^(document|figure|center|enumerate|itemize|table|abstract|proof|lemma|theorem|definition|proposition|corollary|remark|notation|thebibliography)$/)) {
                    // case 1, must be outside math mode
                    if (currentMathMode) {
                        ErrorFromTo(currentMathMode, thisDelimiter, thisDelimiter.name + " used inside " + getName(currentMathMode),
                                    {suppressIfEditing:true, errorAtStart: true, mathMode: true});
                        resetMathMode();
                    };
                    newMathMode = null;
                } else if (name.match(/^(array|gathered|split|aligned|alignedat)\*?$/)) {
                    // case 2, must be inside math mode
                    if (currentMathMode === null) {
                        ErrorFrom(thisDelimiter, thisDelimiter.name + " not inside math mode", {mathMode: true});
                    };
                    newMathMode = currentMathMode;
                } else if (name.match(/^(math|displaymath|equation|eqnarray|multline|align|gather|flalign|alignat)\*?$/)) {
                    // case 3, must be outside math mode but starts it
                    if (currentMathMode) {
                        ErrorFromTo(currentMathMode, thisDelimiter, thisDelimiter.name + " used inside " + getName(currentMathMode),
                                    {suppressIfEditing:true, errorAtStart: true, mathMode: true});
                        resetMathMode();
                    };
                    newMathMode = thisDelimiter;
                } else {
                    // case 4, unknown environments
                    newMathMode = undefined;  // undefined means we don't know if we are in math mode or not
                }
            }
        };
        return newMathMode;
    };

    this.checkAndUpdateState = function (thisDelimiter) {
        if (inVerbatim) {
            if (thisDelimiter.command === "end") {
                this._endVerbatim(thisDelimiter);
            } else {
                return; // ignore anything in verbatim environments
            }
        } else if(thisDelimiter.command === "begin" || thisDelimiter.command === "{" || thisDelimiter.command === "left") {
            if (thisDelimiter.verbatim) {inVerbatim = true;};
            // push new environment onto stack
            var currentMathMode = this.getMathMode(); // undefined, null, $, $$, name of mathmode env
            var newMathMode = getNewMathMode(currentMathMode, thisDelimiter);
            thisDelimiter.mathMode = newMathMode;
            document.openEnv(thisDelimiter);
        } else if (thisDelimiter.command === "end") {
            this._end(thisDelimiter);
        } else if (thisDelimiter.command === "(" || thisDelimiter.command === "[") {
            this._beginMathMode(thisDelimiter);
        } else if (thisDelimiter.command === ")" || thisDelimiter.command === "]") {
            this._end(thisDelimiter);
        } else if (thisDelimiter.command === "}") {
            this._end(thisDelimiter);
        } else if (thisDelimiter.command === "right") {
            this._end(thisDelimiter);
        } else if (thisDelimiter.command === "$" || thisDelimiter.command === "$$") {
            this._toggleMathMode(thisDelimiter);
        }
    };

    this.close = function () {
        // If there is anything left in the state at this point, there
        // were unclosed environments or groups.
        while (document.getDepth() > 0) {
            var thisDelimiter = document.closeEnv();
            if (thisDelimiter.command === "{") {
                // Note that having an unclosed group does not stop
                // compilation in TeX but we will highlight it as an error
                ErrorFrom(thisDelimiter, "unclosed group {", {type:"warning"});
            } else {
                ErrorFrom(thisDelimiter, "unclosed " + getName(thisDelimiter));
            }
        }

        // Filter out any token errors inside verbatim environments
        var vlen = verbatimRanges.length;
        var len = ErrorReporter.tokenErrors.length;
        if (vlen >0 && len > 0) {
            for (var i = 0; i < len; i++) {
                var tokenError = ErrorReporter.tokenErrors[i];
                var startPos = tokenError.startPos;
                var endPos = tokenError.endPos;
                for (var j = 0; j < vlen; j++) {
                    if (startPos > verbatimRanges[j].start && startPos < verbatimRanges[j].end) {
                        tokenError.ignore = true;
                        break;
                    }
                }
            }
        }
    };

    this.setDelimiterProps = function (delimiter) {
        var name = delimiter.name ;
        // flag any verbatim environments for special handling
        if (name && name.match(/^(verbatim|boxedverbatim|lstlisting|minted|Verbatim)$/)) {
            delimiter.verbatim = true;
        }
    };
};

// Error reporting functions for tokens and environments
var ErrorReporter = function (TokeniseResult) {
    var text = TokeniseResult.text;
    var linePosition = TokeniseResult.linePosition;
    var lineNumber = TokeniseResult.lineNumber;

    var errors = [], tokenErrors = [];
    this.errors = errors;
    this.tokenErrors = tokenErrors;
    this.filterMath = false;

    this.getErrors = function () {
        var returnedErrors = [];
        for (var i = 0, len = tokenErrors.length; i < len; i++) {
            if (!tokenErrors[i].ignore) { returnedErrors.push(tokenErrors[i]); }
        }
        var allErrors = returnedErrors.concat(errors);
        var result = [];


        // Find the total number of math errors and bail out if there are too many
        var mathErrorCount = 0;
        for (i = 0, len = allErrors.length; i < len; i++) {
            if (allErrors[i].mathMode) {
                mathErrorCount++;
            }
            if (mathErrorCount > 10) {
                // too many math errors, bailing out
                return [];
            }
        }

        // If the user had \beq and \eeq commands filter out any math
        // errors as we cannot reliably track math-mode when there are
        // user-defined environments which turn it on and off
        if (this.filterMath && mathErrorCount > 0) {
            for (i = 0, len = allErrors.length; i < len; i++) {
                if (!allErrors[i].mathMode) {
                    result.push(allErrors[i]);
                }
            }
            return result;
        } else {
            return allErrors;
        }
    };

    // Report an error in a single token

    this.TokenError = function (token, message, options) {
        if(!options) { options = { suppressIfEditing:true } ; };
        var line = token[0], type = token[1], start = token[2], end = token[3];
        var start_col = start - linePosition[line];
        if (!end) { end = start + 1; } ;
        var end_col = end - linePosition[line];
        tokenErrors.push({row: line,
                          column: start_col,
                          start_row:line,
                          start_col: start_col,
                          end_row:line,
                          end_col: end_col,
                          type:"error",
                          text:message,
                          startPos: start,
                          endPos: end,
                          suppressIfEditing:options.suppressIfEditing,
                          mathMode: options.mathMode});
    };

    // Report an error over a range (from, to)

    this.TokenErrorFromTo = function (fromToken, toToken, message, options) {
        if(!options) { options = {suppressIfEditing:true } ; };
        var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
        var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
        if (!toEnd) { toEnd = toStart + 1;};
        var start_col = fromStart - linePosition[fromLine];
        var end_col = toEnd - linePosition[toLine];

        tokenErrors.push({row: fromLine,
                          column: start_col,
                          start_row: fromLine,
                          start_col: start_col,
                          end_row: toLine,
                          end_col: end_col,
                          type:"error",
                          text:message,
                          startPos: fromStart,
                          endPos: toEnd,
                          suppressIfEditing:options.suppressIfEditing,
                          mathMode: options.mathMode});
    };


    this.EnvErrorFromTo = function (fromEnv, toEnv, message, options) {
        if(!options) { options = {} ; };
        var fromToken = fromEnv.token, toToken = toEnv.closeToken || toEnv.token;
        var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
        if (!toToken) {toToken = fromToken;};
        var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
        if (!toEnd) { toEnd = toStart + 1;};
        var start_col = fromStart - linePosition[fromLine];
        var end_col = toEnd - linePosition[toLine];
        errors.push({row: options.errorAtStart ? fromLine : toLine,
                     column: options.errorAtStart ? start_col: end_col,
                     start_row:fromLine,
                     start_col: start_col,
                     end_row:toLine,
                     end_col: end_col,
                     type: options.type ? options.type : "error",
                     text:message,
                     suppressIfEditing:options.suppressIfEditing,
                     mathMode: options.mathMode});
    };

    // Report an error up to a given environment (from the beginning of the document)

    this.EnvErrorTo = function (toEnv, message, options) {
        if(!options) { options = {} ; };
        var token = toEnv.closeToken || toEnv.token;
        var line = token[0], type = token[1], start = token[2], end = token[3];
        if (!end) { end = start + 1; };
        var end_col = end - linePosition[line];
        var err = {row: line,
                   column: end_col,
                   start_row:0,
                   start_col: 0,
                   end_row: line,
                   end_col: end_col,
                   type: options.type ? options.type : "error",
                   text:message,
                   mathMode: options.mathMode};
        errors.push(err);
    };

    // Report an error from a given environment (up to then end of the document)

    this.EnvErrorFrom = function (delimiter, message, options) {
        if(!options) { options = {} ; };
        var token = delimiter.token;
        var line = token[0], type = token[1], start = token[2], end = token[3];
        var start_col = start - linePosition[line];
        var end_col = Infinity;
        errors.push({row: line,
                     column: start_col,
                     start_row:line,
                     start_col: start_col,
                     end_row: lineNumber,
                     end_col: end_col,
                     type: options.type ? options.type : "error",
                     text:message,
                     mathMode: options.mathMode});
    };
};

var Parse = function (text) {
    var TokeniseResult = Tokenise(text);
    var Reporter = new ErrorReporter(TokeniseResult);
    var Environments = InterpretTokens(TokeniseResult, Reporter);
    Environments.close();
    // console.log(JSON.stringify(Environments.document.getTree())); // Circular :(
    return {
      errors: Reporter.getErrors(),
      contexts: Environments.getDocument().getContexts()
    }
};

    // END PARSER
});
