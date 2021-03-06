var marked = require('marked');

var renderer = new marked.Renderer();
renderer.blockquote = function(quote) {
    var match = quote.match(/%([a-zA-Z ]+)%/);
    if (match) {
        quote = quote.replace(/%([a-zA-Z ]+)%/, '');
        return '<blockquote class="' + match[1] + '">\n' + quote + '</blockquote>\n';
    } else {
        return marked.Renderer.prototype.blockquote.apply(this, arguments);
    }
};

renderer.code = function(code, lang, escaped) {
    var titleMatch = code.match(/^:title:\s*(.*)\n/)
    if (titleMatch) {
        code = code.replace(/^:title:(.*)\n/, '')
    }

    var result = marked.Renderer.prototype.code.call(this, code, lang, escaped);

    var htmlResult = '<figure>'
    if (titleMatch) {
        htmlResult += '<figcaption>' + titleMatch[1] + '</figcaption>';
    }
    htmlResult += result + '</figure>'
    return htmlResult;
};

module.exports = renderer;