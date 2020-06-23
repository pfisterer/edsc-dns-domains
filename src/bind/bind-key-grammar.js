// Generated automatically by nearley, version 2.19.3
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }
var grammar = {
    Lexer: undefined,
    ParserRules: [
    {"name": "keyfile$string$1", "symbols": [{"literal":"k"}, {"literal":"e"}, {"literal":"y"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "keyfile$string$2", "symbols": [{"literal":"a"}, {"literal":"l"}, {"literal":"g"}, {"literal":"o"}, {"literal":"r"}, {"literal":"i"}, {"literal":"t"}, {"literal":"h"}, {"literal":"m"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "keyfile$string$3", "symbols": [{"literal":"s"}, {"literal":"e"}, {"literal":"c"}, {"literal":"r"}, {"literal":"e"}, {"literal":"t"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "keyfile$string$4", "symbols": [{"literal":"\""}, {"literal":";"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "keyfile$string$5", "symbols": [{"literal":"}"}, {"literal":";"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "keyfile", "symbols": ["keyfile$string$1", "whitespace", {"literal":"\""}, "keyname", {"literal":"\""}, "whitespace", {"literal":"{"}, "whitespace", "keyfile$string$2", "whitespace", "algorithm", {"literal":";"}, "whitespace", "keyfile$string$3", "whitespace", {"literal":"\""}, "secret", "keyfile$string$4", "optional_whitespace", "keyfile$string$5", "optional_whitespace"], "postprocess": 
        function(data) {
            return {
                keyname: data[3],
                algorithm:  data[10],
                secret: data[16]
            };
        }
        	},
    {"name": "whitespace$ebnf$1", "symbols": [/[\s]/]},
    {"name": "whitespace$ebnf$1", "symbols": ["whitespace$ebnf$1", /[\s]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "whitespace", "symbols": ["whitespace$ebnf$1"], "postprocess": d => d[0].join('')},
    {"name": "optional_whitespace$ebnf$1", "symbols": []},
    {"name": "optional_whitespace$ebnf$1", "symbols": ["optional_whitespace$ebnf$1", /[\s]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "optional_whitespace", "symbols": ["optional_whitespace$ebnf$1"], "postprocess": d => d[0].join('')},
    {"name": "keyname$ebnf$1", "symbols": [/[^"]/]},
    {"name": "keyname$ebnf$1", "symbols": ["keyname$ebnf$1", /[^"]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "keyname", "symbols": ["keyname$ebnf$1"], "postprocess": d => d[0].join('')},
    {"name": "algorithm$ebnf$1", "symbols": [/[^"]/]},
    {"name": "algorithm$ebnf$1", "symbols": ["algorithm$ebnf$1", /[^"]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "algorithm", "symbols": ["algorithm$ebnf$1"], "postprocess": d => d[0].join('')},
    {"name": "secret$ebnf$1", "symbols": [/[^"]/]},
    {"name": "secret$ebnf$1", "symbols": ["secret$ebnf$1", /[^"]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "secret", "symbols": ["secret$ebnf$1"], "postprocess": d => d[0].join('')}
]
  , ParserStart: "keyfile"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
