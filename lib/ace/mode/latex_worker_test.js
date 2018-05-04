/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

if (typeof process !== "undefined") {
    require("amd-loader");
}

define(function(require, exports, module) {
"use strict";

var assert = require("../test/assertions");
var LatexWorker = require("./latex_worker").LatexWorker;


module.exports = {
    setUp : function() {
        this.sender = {
            on: function() {},
            callback: function(data, id) {
                this.data = data;
            },
            events: [],
            emit: function(type, e) {
                this.events.push([type, e]);
            }
        };
    },

    "test check for simple environment match without errors": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\begin{foo}\n" +
                        "\\end{foo}\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test invalid \\it* command": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\it*hello\n" + "\\bye\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test newcomlumntype": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("hello\n" +
                        "\\newcolumntype{M}[1]{>{\\begin{varwidth}[t]{#1}}l<{\\end{varwidth}}}\n" +
                        "bye");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test newenvironment": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newenvironment{Algorithm}[2][tbh]%\n" +
                        "{\\begin{myalgo}[#1]\n" +
                        "\\centering\n" +
                        "\\part{title}\\begin{minipage}{#2}\n" +
                        "\\begin{algorithm}[H]}%\n" +
                        "{\\end{algorithm}\n" +
                        "\\end{minipage}\n" +
                        "\\end{myalgo}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test newenvironment II": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newenvironment{claimproof}[1][\\myproofname]{\\begin{proof}[#1]\\renewcommand*{\\qedsymbol}{\\(\\diamondsuit\\)}}{\\end{proof}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test superscript inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $a^b$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test subscript inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $a_b$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test superscript outside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is a^b test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 1);
        assert.equal(errors[0].text, "^ must be inside math mode");
        assert.equal(errors[0].type, "error");
    },

    "test subscript outside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is a_b test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 1);
        assert.equal(errors[0].text, "_ must be inside math mode");
        assert.equal(errors[0].type, "error");
    },

    "test math mode inside \\hbox outside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is \\hbox{for every $bar$}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },


    "test math mode inside \\hbox inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $foo = \\hbox{for every $bar$}$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math mode inside \\text inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $foo = \\text{for every $bar$}$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test verbatim": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{verbatim}\n" +
                        "this is verbatim\n" +
                        "\\end{verbatim}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test verbatim with environment inside": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{verbatim}\n" +
                        "this is verbatim\n" +
                        "\\begin{foo}\n" +
                        "this is verbatim too\n" +
                        "\\end{foo}\n" +
                        "\\end{verbatim}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },


    "test verbatim with \\begin{verbatim} inside": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{verbatim}\n" +
                        "this is verbatim\n" +
                        "\\begin{verbatim}\n" +
                        "this is verbatim too\n" +
                        "\\end{verbatim}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test equation": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{equation}\n" +
                        "\\alpha^2 + b^2 = c^2\n" +
                        "\\end{equation}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test $$": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "$$\n" +
                        "\\alpha^2 + b^2 = c^2\n" +
                        "$$\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test $": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text $\\alpha^2 + b^2 = c^2$" +
                        " this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\[": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\[\n" +
                        "\\alpha^2 + b^2 = c^2\n" +
                        "\\]\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\(": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text \\(\\alpha^2 + b^2 = c^2\\)" +
                        " this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\begin{foo}": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{foo}\n" +
                        "this is foo\n" +
                        "\\end{foo}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\begin{foo_bar}": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{foo_bar}\n" +
                        "this is foo bar\n" +
                        "\\end{foo_bar}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\begin{foo} \\begin{bar}": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{foo}\n" +
                        "\\begin{bar}\n" +
                        "\\begin{baz}\n" +
                        "this is foo bar baz\n" +
                        "\\end{baz}\n" +
                        "\\end{bar}\n" +
                        "\\end{foo}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\verb|...|": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text \\verb|hello| and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\verb|...| with special chars": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text \\verb|{}()^_@$x\hello| and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\url|...|": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text \\url|http://www.sharelatex.com/| and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\url{...}": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text \\url{http://www.sharelatex.com/} and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },


    "test \\url{...} with % chars": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text \\url{http://www.sharelatex.com/hello%20world} and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },


    "test \\left( and \\right)": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("math $\\left( x + y \\right) = y + x$ and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\left( and \\right.": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("math $\\left( x + y \\right. = y + x$ and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test \\left. and \\right)": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("math $\\left. x + y \\right) = y + x$ and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test complex math nesting": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("math $\\left( {x + {y + z} + x} \\right\\} = \\left[y + x\\right.$ and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math toggling $a$$b$": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("math $a$$b$ and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math toggling $$display$$$inline$": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("math $$display$$$inline$ and more\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math definition commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\let\\originalleft\\left\n" +
                        "\\let\\originalright\\right\n" +
                        "\\renewcommand{\\left}{\\mathopen{}\\mathclose\\bgroup\\originalleft}\n" +
                        "\\renewcommand{\\right}{\\aftergroup\\egroup\\originalright}\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math reflectbox commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("$\\reflectbox{$\alpha$}$\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math scalebox commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("$\\scalebox{2}{$\alpha$}$\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math rotatebox commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("$\\rotatebox{60}{$\alpha$}$\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math resizebox commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("$\\resizebox{2}{3}{$\alpha$}$\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },


    "test all math box commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\[ \\left(\n" +
                        "\\shiftright{2ex}{\\raisebox{-2ex}{\\scalebox{2}{$\\ast$}}}\n" +
                        "\\reflectbox{$\ddots$}\n" +
                        "\\right). \\]\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math tag commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("$\\tag{$\alpha$}$\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math \\def commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\def\\peb[#1]{{\\left\\lfloor #1\\right\\rfloor}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test math \\def commands II": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\def\\foo#1{\\gamma^#1}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test DeclareMathOperator": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\DeclareMathOperator{\\var}{\\Delta^2\\!}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test DeclarePairedDelimiter": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\DeclarePairedDelimiter{\\spro}{\\left(}{\\right)^{\\ast}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test nested user-defined math commands": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("$\\foo{$\\alpha \\bar{x^y}{\\cite{hello}}$}{\\gamma}{$\\beta\\baz{\\alpha}$}{\\cite{foo}}$");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test nested user-defined math commands II": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\foo{$\\alpha \\bar{x^y}{\\cite{hello}}$}{\\gamma}{$\\beta\\baz{\\alpha}$}{\\cite{foo}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },


    "test newenvironment with multiple parameters": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newenvironment{case}[1][\\textsc{Case}]\n" +
                        "{\\begin{trivlist}\\item[\\hskip \\labelsep {\\textsc{#1}}]}{\\end{trivlist}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test newenvironment with no parameters": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newenvironment{case}{\\begin{trivlist}\\item[\\hskip \\labelsep {\\textsc{#1}}]}{\\end{trivlist}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test tikzfeynman": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\begin{equation*}\n"
                        +   "\\feynmandiagram[layered layout, medium, horizontal=a to b] {\n"
                        +      " a [particle=\\(H\\)] -- [scalar] b [dot] -- [photon] f1 [particle=\\(W^{\\pm}\\)],\n"
                        +      " b -- [boson, edge label=\\(W^{\\mp}\\)] c [dot],\n"
                        +      " c -- [fermion] f2 [particle=\\(f\\)],\n"
                        +      " c -- [anti fermion] f3 [particle=\\(\\bar{f}'\\)],\n"
                        +  " };this is a change\n"
                        + "\\end{equation*}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test errors from malformed \\end": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{foo}\n" +
                        "\\begin{bar}\n" +
                        "this is foo bar baz\n" +
                        "\\end{bar\n" +
                        "\\end{foo}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 3);
        assert.equal(errors[0].text, "invalid environment command \\end{bar");
        assert.equal(errors[1].text, "unclosed open group { found at \\end{foo}");
        assert.equal(errors[2].text, "unexpected \\end{foo} after \\begin{bar}");
    },

    "test \\newcommand*": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newcommand*{\\foo}{\\bar}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    "test incomplete \\newcommand*": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newcommand*{\\beq" +
                        "}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1].errors;
        assert.equal(errors.length, 0);
    },

    // %novalidate
    // %begin novalidate
    // %end novalidate
    // \begin{foo}
    // \begin{new_theorem}
    // \begin{foo   invalid environment command
    // \newcommand{\foo}{\bar}
    // \newcommand[1]{\foo}{\bar #1}
    // \renewcommand...
    // \def
    // \DeclareRobustCommand
    // \newcolumntype
    // \newenvironment
    // \renewenvironment
    // \verb|....|
    // \url|...|
    // \url{...}
    // \left(   \right)
    // \left.   \right.
    // $...$
    // $$....$$
    // $...$$...$
    // $a^b$ vs a^b
    // $$a^b$$ vs a^b
    // Matrix for envs for {} left/right \[ \] \( \) $ $$ begin end
    // begin equation
    // align(*)
    // equation(*)
    // ]
    // array(*)
    // eqnarray(*)
    // split
    // aligned
    // cases
    // pmatrix
    // gathered
    // matrix
    // alignedat
    // smallmatrix
    // subarray
    // vmatrix
    // shortintertext

    "test math mode contexts": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\begin{document}\n"
                        + "$$\n"
                        + "\\begin{array}\n"
                        + "\\left( \\foo{bar} \\right\] & 2\n"
                        + "\\end{array}\n"
                        + "$$\n"
                        + "\\end{document}");
        worker.deferredUpdate.call();

        var contexts = this.sender.events[0][1].contexts;
        assert.equal(contexts.length, 1);
        assert.equal(contexts[0].type, "math");
        assert.equal(contexts[0].range.start.row, 1);
        assert.equal(contexts[0].range.start.column, 0);
        assert.equal(contexts[0].range.end.row, 5);
        assert.equal(contexts[0].range.end.column, 2);
    }
};

});

if (typeof module !== "undefined" && module === require.main) {
    require("asyncjs").test.testcase(module.exports).exec();
}
