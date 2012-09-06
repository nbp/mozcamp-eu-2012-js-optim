function Range(beg, end) {
    this.beg = beg;
    this.end = end;
    return this;
};

Range.prototype.contains = function (r) {
    return this.beg <= r.beg && r.end <= this.end;
};

function Profiler(elem) {
    this.elem = elem;
    this.input = elem.getElementsByClassName("input")[0];
    this.outputs = elem.getElementsByClassName("output");
    this.message = elem.getElementsByClassName("status")[0];
    this.scripts = [];
    this.details = [];
    this.parseTrees = [];
    this.deltaTimes = [];
    this.hasDescriptions = true;
    this.totals = {};
    this.totalActivity = 1;

    var self = this;
    if (this.input) {
      this.input.ondblclick = function () {
        self.run();
      };
    }

    this.setupSwitch(elem, "toBarrier", "barrier");
    this.setupSwitch(elem, "toActivity", "activity");
    this.setupSwitch(elem, "toTypes", "types");
};

Profiler.prototype.setupSwitch = function (dom, className, highlight) {
  var elems = dom.getElementsByClassName(className);
  for (var i = 0; i < elems.length; ++i) {
    var elem = elems[i];
    elem.onclick = function () {
      elem.setAttribute("highlight", highlight);
    };
  }
}

Profiler.prototype.addParseTreeNode = function (trees, node) {
    var newTrees = [];
    var n = 0;
    for (; n < trees.length; ++n) {
        var ins = trees[n];

        if (node.script < ins.script) {
            newTrees.push(node);
            return newTrees.concat(trees.slice(n));
        }

        if (node.script == ins.script) {
            if (node.position.contains(ins.position)) {
                do {
                    node.childNodes = this.addParseTreeNode(node.childNodes, ins);
                    if (++n >= trees.length)
                        break;
                    ins = trees[n];
                } while(node.position.contains(ins.position));
                newTrees.push(node);
                return newTrees.concat(trees.slice(n));
            }

            if (ins.position.contains(node.position)) {
                ins.childNodes = this.addParseTreeNode(ins.childNodes, node);
                return trees;
            }

            if (node.position.beg < ins.position.beg) {
                newTrees.push(node);
                return newTrees.concat(trees.slice(n));
            }
        }

        newTrees.push(ins);
    }

    newTrees.push(node);
    return newTrees;
};

Profiler.prototype.addNode = function (node) {
    this.parseTrees = this.addParseTreeNode(this.parseTrees, node);
};

Profiler.prototype.rebuildParseTrees = function () {
    var count = this.scripts.length;
    for (var i = 0; i < count; ++i) {
        var summary = this.scripts[i];
        var detail = this.details[i];

        var sumNode = {
            script: i,
            bytecode: {
                index: -1,
                offset: 0,
                name: "script"
            },
            text: detail.text,
            position: new Range(0, detail.text.length),
            totals: summary.totals,
            counts: {},
            childNodes: []
        };
        this.addNode(sumNode);

        var maxTextOffset = 0;
        for (var j = 0; j < detail.opcodes.length; j++) {
            var op = detail.opcodes[j];
            var begin = op.textOffset || maxTextOffset;
            maxTextOffset = Math.max(begin, maxTextOffset);
            var text = op.text || "";

            var node = {
                script: i,
                bytecode: {
                    index: j,
                    offset: op.id,
                    name: op.name
                },
                text: text,
                position: new Range(begin, begin + text.length),
                totals: {},
                counts: op.counts,
                childNodes: []
            };
            this.addNode(node);
        };
    }
};

Profiler.prototype.computeTotals = function () {
    var count = this.scripts.length;
    for (var i =0; i < count; ++i) {
        var summary = this.scripts[i];
        for (var s in summary.totals) {
            this.totals[s] = (this.totals[s] || 0) + summary.totals[s];
        }
    }
    this.totalActivity = this.countActivity(this.totals);
};

Profiler.prototype.clearDescriptions = function () {
    var descs = this.message.getElementsByClassName("description");
    if (!descs)
        return;
    var i = descs.length;
    while (--i >= 0) {
        this.message.removeChild(descs[i]);
    }
}

Profiler.prototype.displayNodeInfo = function (node) {
    var desc = document.createElement("div");
    var source = this.serializeNode(node);
    var code = document.createElement("code");
    var pre = document.createElement("pre");
    code.appendChild(source);
    pre.appendChild(code);

    var detail = document.createElement("span");
    detail.classList.add("counts");
    detail.setAttribute("highlight", "barrier types activity");
    for (var i in node.counts) {
        var fakeNode = { counts: {} };
        fakeNode.counts[i] = node.counts[i];
        
        var count = document.createElement("span");
        count.appendChild(document.createTextNode(node.counts[i].toString()));
        this.reportInfer(fakeNode, count);
        this.reportTypes(fakeNode, count);
        this.reportActivity(fakeNode, count);
        
        var stat = document.createElement("span");
        stat.appendChild(document.createTextNode(i + ": "));
        stat.appendChild(count);
        
        detail.appendChild(stat);
    }

    desc.appendChild(pre);
    desc.appendChild(detail);
    desc.classList.add("description");
    this.message.appendChild(desc);
};

// Extracted from the CodeInspector made by Brian Hackett.
Profiler.prototype.countActivity = function (counts) {
    var stubs = counts.mjit_calls || 0;
    var code = counts.mjit_code || 0;
    var pics = counts.mjit_pics || 0;
    return (stubs * 100) + code + pics;
};

Profiler.prototype.reportInfer = function (node, span) {
    if ("infer_barrier" in node.counts) {
        span.classList.add("barrier");
    }
};

Profiler.prototype.reportActivity = function (node, span) {
    var activity = this.countActivity(node.counts);
    activity = Math.floor(activity * 100 / this.totalActivity);
    if (activity) {
        activity = Math.min(activity, 10);
        span.classList.add("activity" + activity);
    }
};

Profiler.prototype.reportTypes = function (node, span) {
    var type = "";
    function addType(t) {
        if (type == "")
            type = t;
        else
            type = "t_conflict";
    }

    if ("observe_undefined" in node.counts)
        addType("t_undefined");
    if ("observe_null" in node.counts)
        addType("t_null");
    if ("observe_boolean" in node.counts)
        addType("t_boolean");
    if ("observe_int32" in node.counts || "arith_int" in node.counts)
        addType("t_int32");
    if ("observe_double" in node.counts || "arith_double" in node.counts)
        addType("t_double");
    if ("observe_string" in node.counts)
        addType("t_string");
    if ("observe_object" in node.counts)
        addType("t_object");
    if ("arith_other" in node.counts)
        addType("t_other");
    if ("arith_unknown" in node.counts)
        addType("t_unknown");
    if (type != "")
        span.classList.add(type);
};

Profiler.prototype.serializeNode = function (node) {
    var start = node.position.beg;
    var last = start;
    var span = document.createElement("span");
    for (var i = 0; i < node.childNodes.length; ++i) {
        var child = node.childNodes[i];
        if (last < child.position.beg) {
            var text = document.createTextNode(node.text.slice(last - start, child.position.beg - start));
            span.appendChild(text);
        }
        span.appendChild(this.serializeNode(child));
        last = child.position.end;
    }
    if (last < node.position.end) {
        var text = document.createTextNode(node.text.slice(last - start));
        span.appendChild(text);
    }

    this.reportInfer(node, span);
    this.reportTypes(node, span);
    this.reportActivity(node, span);

    var profiler = this;
    function describe() {
        if (profiler.hasDescriptions) {
            profiler.clearDescriptions();
        }
        profiler.hasDescriptions = (node.bytecode.index < 0);
        if (!profiler.hasDescriptions) {
            profiler.displayNodeInfo(node);
        }
    };
    span.onclick = describe;
    span.onkeydown = describe;

    return span;
};

Profiler.prototype.serialize = function () {
    var span = document.createElement("span");
    for (var i = 0; i < this.parseTrees.length; i++) {
        if (i != 0) {
            span.appendChild(document.createTextNode("\n\n"));
        }
        span.appendChild(this.serializeNode(this.parseTrees[i]));
    }
    return span;
};

Profiler.prototype.render = function () {
    var content = this.serialize();
    for (var o = 0; o < this.outputs.length; ++o) {
        if (o)
            content = content.cloneNode();
        var output = this.outputs[o];
        if (output.hasChildNodes()) {
            while (output.childNodes.length > 1) {
                output.removeChild(output.firstChild);
            }
            output.replaceChild(content, output.firstChild);
        } else {
            output.appendChild(content);
        }
    }
    
    var meanTime = this.deltaTimes.reduce(function (a, b) a + b) / this.deltaTimes.length;
    var m = "";
    m += "Avg. Time: " + meanTime + " ms";
    //m += ", FPS: " + (1000 / meanTime);
    if (this.message)
      this.message.innerHTML = m;
};

Profiler.prototype.benchmark = function __benchmark__ () {
    this.scripts = [];
    this.details = [];
    this.parseTrees = [];
 
    const Ci = Components.interfaces;
    var utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    var run = eval(this.input.value);
    if (!run) {
        this.message.innerHTML = "No function found.";
        return;
    }

    // Profile with PC Count
    var endTime = (new Date()).getTime();
    var stopTime = endTime + 1000; /*  1s is 1000*/
    utils.startPCCountProfiling();
    while ((new Date()).getTime() < stopTime)
        run();
    utils.stopPCCountProfiling();

    // Profile with Time.
    endTime = (new Date()).getTime();
    stopTime = endTime + 1000; /*  1s is 1000*/
    var deltaTimes = []; // expected number of samples.
    while (endTime < stopTime) {
        var startTime = (new Date()).getTime();
        run();
        endTime = (new Date()).getTime();
        deltaTimes.push(endTime - startTime);
    };
    
    this.deltaTimes = deltaTimes;

    var count = utils.getPCCountScriptCount();
    for (var i = 0; i < count; i++) {
        var summary = JSON.parse(utils.getPCCountScriptSummary(i));
        if (!summary.file.match("profile") || summary.name == "__benchmark__")
            continue;
        
        var detail = JSON.parse(utils.getPCCountScriptContents(i));
        summary.decompText = detail.text;

        this.scripts.push(summary);
        this.details.push(detail);
    }

    utils.purgePCCounts();
};

Profiler.prototype.run = function () {
    this.totals = {};
    this.benchmark();
    this.rebuildParseTrees();
    this.computeTotals();
    this.render();
};


function init() {
    var profilers = document.getElementsByClassName("profiler");
    var i = 0;
    for (i = 0; i < profilers.length; ++i) {
        profilers[i].profiler = new Profiler(profilers[i]);
    }
    return i;
}
document.onload = init();
