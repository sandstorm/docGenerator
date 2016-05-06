String.prototype.filename = function() {
    var delimiterIndex = this.lastIndexOf('/');
    if (delimiterIndex < 0) {
        return this;
    }
    return this.substring(delimiterIndex + 1);
};

String.prototype.parentPath = function() {
    var delimiterIndex = this.lastIndexOf('/');
    if (delimiterIndex < 0) {
        return '.';
    }
    return this.substring(0, delimiterIndex);
};

String.prototype.basename = function() {
    var filename = this.filename();

    var delimiterIndex = filename.lastIndexOf('.');
    if (delimiterIndex < 0) {
        return filename;
    }
    return filename.substring(0, delimiterIndex);
};

String.prototype.ending = function() {
    var delimiterIndex = this.lastIndexOf('.');
    if (delimiterIndex < 0) {
        return '';
    }
    return this.substring(delimiterIndex + 1);
};



var gulp = require('gulp');
var changed = require('gulp-changed');
var docGenPlugin = require('gulp-source-comment-extract');
var markdown = require('gulp-markdown');
var rename = require('gulp-rename');
var replace = require('gulp-replace');
var highlight = require('highlight.js');
var sass = require('gulp-sass');
var insert = require('gulp-insert');
var swig = require('gulp-swig');
var flatten = require('gulp-flatten');
var toc = require('gulp-toc');
var renderer = require('./src/renderer');
var util = require('gulp-util');
var through = require('through2');
var concat = require('gulp-concat');

gulp.task('default', ['sassCompile', 'sourceCodeCompile', 'examplesCompile'], function() {
    // place code for your default task here
});


if (!util.env.config) {
    console.error('!!! configuration file not specified.');
    process.exit(1);
}
var config = require(process.env.INIT_CWD + '/' + util.env.config);

if (!config.paths) {
    console.error('!!! configuration file does not specify paths.');
    process.exit(1);
}
/*paths = {
    sourceCode: [
        '...'
    ],
    examples: [
        '...'
    ],
    dest: 'tmp'
};*/

var exampleFile = "PredefinedScripts.html";
var paths = config.paths;
var targetFiles = {};
if (paths.examples) {
    targetFiles[exampleFile] = true;
}


gulp.task('sassCompile', [], function() {
    return gulp.src(__dirname + '/scss/main.scss')
        .pipe(sass())
        .pipe(gulp.dest(paths.dest));
});

gulp.task('layoutCopy', [], function() {
    return gulp.src([__dirname + '/layout.html', __dirname + '/node_modules/highlight.js/styles/github.css'])
        .pipe(gulp.dest(paths.dest));
});

/**
 * This gulp-target collects all names of the html files
 * which are generated even before they are actually created.
 *
 * The list of file is stored into a global object (as a mapping).
 * The information is used to link only existing target files.
 */
gulp.task('collectTargets', [], function() {
    return gulp.src(paths.sourceCode)
        .pipe(flatten())
        .pipe(rename({extname: '.html'}))
        .pipe(through.obj(function(file, enc, cb) {
            if (file.isStream()) {
                this.emit('error', 'Streams are not supported!');
                return cb();
            }

            var filename = file.path.filename();
            targetFiles[filename] = true;

            // make sure the file goes through the next gulp plugin
            this.push(file);
            // tell the stream engine that we are done with this file
            return cb();
        }));
});

/**
 * This tasks collects all examples and publishes them
 */
gulp.task('examplesCompile', ['collectTargets'], function () {
    if (!paths.examples) {
        return;
    }
    return gulp.src(paths.examples)
        .pipe(flatten())
        .pipe(through.obj(function(file, enc, cb) {
            if (file.isStream()) {
                this.emit('error', 'Streams are not supported!');
                return cb();
            }

            var parentName = file.path.parentPath().basename();
            var basename = file.path.basename();
            var ending = file.path.ending();
            var includePath = file.path.substring(file.path.lastIndexOf('/predefined/'));

            switch (ending) {
                case "md":
                    file.contents = new Buffer("\n"
                        + "## " + parentName + "\n"
                        + "\n"
                        + file.contents + "\n"
                        + "\n"
                    );
                    break;
                case "groovy":
                    file.contents = new Buffer("\n"
                        + "### " + basename + "\n"
                        + "\n"
                        + "```\n"
                        + file.contents + "\n"
                        + "```\n"
                        + "\n"
                        + "```\n"
                        + ":title: Example include of this pre-defined file\n"
                        + "include \"" + includePath + "\"\n"
                        + "```\n"
                        + "\n"
                    );
                    break;
                default:
                    break;
            }

            // make sure the file goes through the next gulp plugin
            this.push(file);
            // tell the stream engine that we are done with this file
            return cb();
        }))
        // make one large example reference file
        .pipe(concat(exampleFile))

        // compile to HTML as in sourceCodeCompile
        // TODO: 100 % copy-paste-code from sourceCodeCompile => refactor
        .pipe(rename({extname: '.md'}))
        .pipe(insert.append("\n\n## Other DSL-References\n\n"))
        .pipe(insert.append(createMdLinks(targetFiles)))
        .pipe(gulp.dest(paths.dest))
        .pipe(markdown({
            highlight: function (code) {
                return highlight.highlight("groovy", code).value;
            },
            renderer: renderer
        }))
        .pipe(rename({extname: '.html'}))

        .pipe(insert.prepend("{% extends 'layout.html' %} {% block toc %} <!-- toc --> {% endblock %} {% block content %}"))
        .pipe(insert.append("{% endblock %}"))
        .pipe(toc())
        .pipe(swig())
        .pipe(gulp.dest(paths.dest));
});

gulp.task('sourceCodeCompile', ['layoutCopy', 'collectTargets'], function() {
    return gulp.src(paths.sourceCode)
        .pipe(flatten())
        //.pipe(changed(paths.dest))
        .pipe(docGenPlugin('groovy', {
            // we want the deprecation messages from the javaDoc
            // so we skip all line starting with '@' unless followed by 'deprecated'
            // see http://stackoverflow.com/questions/406230/regular-expression-to-match-string-not-containing-a-word
            'skipCommentLinesMatchingRegex': '^@(?!deprecated).*',
            'commentPostprocessor': function(comment, context) {
                if (!context.followingLineIs('@API', 4) && comment.indexOf('!non-api!') === -1) {
                    // skip blocks which do not have an API annotation, except if they contain "!non-api!"
                    return;
                }

                var result;
                var keyword;

                // extract method or property name from declaration
                if (result = context.followingLineMatches(/^((def|abstract|public|protected|static|final)\s+)*\w+(<[^<>]+>)?\s+(\w+)/, 4)) {
                    keyword = normalizeMemberName(result[result.length - 1]);
                    comment = '## ' + keyword + '\n\n' + comment;
                }

                // convert javaDoc @deprecated and @DeprecatedSince
                if (result = comment.match(/@deprecated (.*)/)) {
                    var deprecatedSinceMatch = context.followingLineMatches(/^@DeprecatedSince\([^\)]*version\s+=\s+(("([^"]*)")|('([^']*)'))[^\)]*\)/, 4);
                    var deprecatedSince = undefined;
                    if (deprecatedSinceMatch) {
                        if (deprecatedSinceMatch[3]) {
                            deprecatedSince = deprecatedSinceMatch[3]
                        }
                        if (deprecatedSinceMatch[5]) {
                            deprecatedSince = deprecatedSinceMatch[5]
                        }
                    }

                    var deprecationWarning = '> %deprecated% This part of the API is marked **deprecated';
                    if (deprecatedSince) {
                        deprecationWarning += ' since version ' + deprecatedSince;
                    }
                    deprecationWarning += '** and will be removed soon.';
                    var deprecationFix = '> %fix% ' + result[1];

                    comment = comment.replace(result[0], deprecationWarning + '\n\n<!-- -->\n\n' + deprecationFix + '\n\n')
                }

                // convert javaDoc links
                while (/(\{@link\s+(\S+\.)*(\w+)(#(\w+)[^\}]*)?\})/.test(comment)) {
                    var link = RegExp.$1
                    var targetType = RegExp.$3
                    var targetMember = RegExp.$5
                    var linkText = targetType;
                    var linkTarget = targetType + '.html';
                    if(targetMember) {
                        targetMember = normalizeMemberName(targetMember);
                        linkText += "#" + targetMember;
                        linkTarget += "#" + targetMember.toLowerCase();
                    }
                    comment = comment.replace(link, reference(linkText, linkTarget))
                }

                // link base class
                if (result = context.followingLineMatches(/((def|abstract|public|static|final)\s+)*class\s+\w+(<[^<>]+>)?\s+extends\s+(\w+)(<[^<>]+>)?/, 4)) {
                    var baseClass = result[result.length - 2]
                    comment += '\n See the [' + baseClass + '](' + baseClass + '.html)-reference for a list of inherited keywords.';
                }

                // extract execution context of the passed closure
                // !!! NOTE: currently supports at most ONE closure as argument !!!
                if (result = context.followingLineMatches(/@DelegatesTo\([^\)]*value\s*=\s*(\w+)[^\)]*\)\s*Closure/, 4)) {
                    comment += '\n See the ' + reference(result[1], result[1] + '.html' ) + '-reference for a list of valid keywords';
                    if(keyword) {
                        comment += ' inside `' + keyword + '`';
                    }
                    comment += '.'
                }

                return comment;
            }

        }))
        .pipe(replace('!non-api!', '> %warning% This part does not belong to the public API and might change without further notice!\n\nDo not use this in production!'))
        .pipe(replace('!since5.1!', '\n\nIntroduced in **Version 5.1**.\n\n'))
        .pipe(replace('!since5.2!', '\n\nIntroduced in **Version 5.2**.\n\n'))
        .pipe(replace('!since5.3!', '\n\nIntroduced in **Version 5.3**.\n\n'))
        .pipe(replace('!since5.4!', '\n\nIntroduced in **Version 5.4**.\n\n'))
        .pipe(replace('!since5.5!', '\n\nIntroduced in **Version 5.5**.\n\n'))
        .pipe(replace('!since5.6!', '\n\nIntroduced in **Version 5.6**.\n\n'))
        .pipe(replace('!since5.7!', '\n\nIntroduced in **Version 5.7**.\n\n'))
        .pipe(rename({extname: '.md'}))
        .pipe(insert.append("\n\n## Other DSL-References\n\n"))
        .pipe(insert.append(createMdLinks(targetFiles)))
        .pipe(gulp.dest(paths.dest))
        .pipe(markdown({
            highlight: function (code) {
                return highlight.highlight("groovy", code).value;
            },
            renderer: renderer
        }))
        .pipe(rename({extname: '.html'}))

        .pipe(insert.prepend("{% extends 'layout.html' %} {% block toc %} <!-- toc --> {% endblock %} {% block content %}"))
        .pipe(insert.append("{% endblock %}"))
        .pipe(toc())
        .pipe(swig())
        .pipe(gulp.dest(paths.dest));
});

function normalizeMemberName(name) {
    // translate property name if is getter
    if (name.indexOf('get') === 0) {
        name = name.substr(3);
        // lower case MyFancyProperty from getMyFancyProperty
        // do not lower case MYUPPERCASEPROPERTY from getMYUPPERCASEPROPERTY
        if (name.match(/[a-z]+/)) {
            name = name.substr(0, 1).toLocaleLowerCase() + name.substr(1);
        }
    }
    return name
}

function createMdLinks(targetFiles) {
    var mdLinks = "";
    for(var targetFile in targetFiles) {
        var basename = targetFile.substring(0, targetFile.lastIndexOf('.'));
        mdLinks += "* " + reference(basename, targetFile) + "\n"
    }
    return mdLinks;
}

function reference(name, target) {
    var sharpIndex = target.indexOf('#');
    var file = target;
    if (sharpIndex >= 0) {
        file = target.substr(0, sharpIndex);
    }
    // link only existing targets
    if (targetFiles[file]) {
        return '[' + name + '](' + target + ')';
    }
    return name
}

// Rerun the task when a file changes
gulp.task('watch', function() {
    gulp.watch(paths.sourceCode, ['sourceCodeCompile']);
});
