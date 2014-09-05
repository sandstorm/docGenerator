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


gulp.task('sassCompile', [], function() {
    return gulp.src(__dirname + '/scss/main.scss')
        .pipe(sass())
        .pipe(gulp.dest(paths.dest));
});

gulp.task('layoutCopy', [], function() {
    return gulp.src([__dirname + '/layout.html', __dirname + '/node_modules/highlight.js/styles/github.css'])
        .pipe(gulp.dest(paths.dest));
});



gulp.task('sourceCodeCompile', ['layoutCopy'], function() {
    return gulp.src(paths.sourceCode)
        .pipe(flatten())
        //.pipe(changed(paths.dest))
        .pipe(docGenPlugin('groovy', {
            'commentPostprocessor': function(comment, context) {
                if (!context.followingLineIs('@API', 4) && comment.indexOf('!non-api!') === -1) {
                    // skip blocks which do not have an API annotation, except if they contain "!non-api!"
                    return;
                }

                var result;
                if (result = context.followingLineMatches(/^public [a-zA-Z]+ ([a-zA-Z]+)\(/, 4)) {
                    comment = '## ' + result[1] + '\n\n' + comment;
                }

                return comment;
            }

        }))
        .pipe(replace('!non-api!', '> %warning% This part does not belong to the public API and might change without further notice!\n\nDo not use this in production!'))
        .pipe(replace('!since5.1!', '\n\nIntroduced in **Version 5.1**.\n\n'))
        .pipe(rename({extname: '.md'}))
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

// Rerun the task when a file changes
gulp.task('watch', function() {
    gulp.watch(paths.sourceCode, ['sourceCodeCompile']);
});
