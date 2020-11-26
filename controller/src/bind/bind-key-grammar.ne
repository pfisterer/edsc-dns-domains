keyfile -> "key" whitespace "\"" keyname "\"" whitespace "{" 
	whitespace "algorithm" whitespace algorithm ";"
	whitespace "secret" whitespace "\"" secret "\";"
	optional_whitespace "};" optional_whitespace {%
    function(data) {
        return {
            keyname: data[3],
            algorithm:  data[10],
            secret: data[16]
        };
    }
	%}

whitespace -> [\s]:+ {% d => d[0].join('') %}
optional_whitespace -> [\s]:* {% d => d[0].join('') %}

keyname -> [^"]:+ {% d => d[0].join('') %}

algorithm -> [^"]:+ {% d => d[0].join('') %}

secret -> [^"]:+ {% d => d[0].join('') %}