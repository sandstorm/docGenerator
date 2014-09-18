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

gulp.task('default', ['sassCompile', 'sourceCodeCompile'], function() {
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
    dest: 'tmp'
};*/

var paths = config.paths;
var targetFiles = {};


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

            var filename = file.path.substring(file.path.lastIndexOf('/') + 1);
            targetFiles[filename] = true;

            // make sure the file goes through the next gulp plugin
            this.push(file);
            // tell the stream engine that we are done with this file
            return cb();
        }));
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
                if (result = context.followingLineMatches(/^((def|abstract|public|static|final)\s+)*\S+\s+(\w+)/, 4)) {
                    keyword = result[result.length-1];
                    // translate property name if is getter
                    if(keyword.indexOf('get') === 0) {
                        keyword = keyword.substr(3);
                        // lower case MyFancyProperty from getMyFancyProperty
                        // do not lower case MYUPPERCASEPROPERTY from getMYUPPERCASEPROPERTY
                        if(keyword.match(/[a-z]+/)) {
                            keyword = keyword.substr(0, 1).toLocaleLowerCase() + keyword.substr(1);
                        }
                    }
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
                while (/(\{@link\s+(\S+\.)*(\w+)\})/.test(comment)) {
                    var link = RegExp.$1
                    var target = RegExp.$3
                    comment = comment.replace(link, reference(target, target + '.html'))
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

function createMdLinks(targetFiles) {
    var mdLinks = "";
    for(var targetFile in targetFiles) {
        var basename = targetFile.substring(0, targetFile.lastIndexOf('.'));
        mdLinks += "* " + reference(basename, targetFile) + "\n"
    }
    return mdLinks;
}

function reference(name, target) {
    // link only existing targets
    if(targetFiles[target]) {
        return '[' + name + '](' + target + ')';
    }
    return name
}

// Rerun the task when a file changes
gulp.task('watch', function() {
    gulp.watch(paths.sourceCode, ['sourceCodeCompile']);
});
