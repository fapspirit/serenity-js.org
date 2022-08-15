/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const path = require('path');
const fs = require('fs-extra');
const pluginContentBlog = require('@docusaurus/plugin-content-blog');
const {aliasedSitePath, docuHash, normalizeUrl} = require('@docusaurus/utils');

/**
 * Multiple versions may be published on the same day, causing the order to be
 * the reverse. Therefore, our publish time has a "fake hour" to order them.
 */
const publishTimes = new Set();
/**
 * @type {Record<string, {name: string, url: string,alias: string, imageURL: string}>}
 */
const authorsMap = {};

// ## [2.0.1-alpha.117](https://github.com/jan-molak/serenity-js/compare/v2.0.1-alpha.116...v2.0.1-alpha.117) (2020-01-29)
const sectionLimitPattern = '(?=\\n#{1,3} \\[.*\\]\\(.*\\) \\(.*?\\))'
const titlePattern = '#{1,3} \\[(?<version>.*?)\\]\\((?<compare_link>.*?)\\) \\((?<release_date>.*?)\\)'


/**
 * @param {string} section
 */
function processSection(section) {
    const titleLineMatch = section
        .match(new RegExp(`\n${ titlePattern }`));

    if (!titleLineMatch?.[0]) {
        return null;
    }

    const title = titleLineMatch.groups.version;
    const diffLink = titleLineMatch.groups.compare_link;

    const content = section
        .replace(titleLineMatch[0], '')
        .trim();

    let authors = content.match(/## Committers: \d.*/s);
    if (authors) {
        authors = authors[0]
            .match(/- .*/g)
            .map(
                (line) =>
                    line.match(
                        /- (?:(?<name>.*?) \()?\[@(?<alias>.*)\]\((?<url>.*?)\)\)?/,
                    ).groups,
            )
            .map((author) => ({
                ...author,
                name: author.name ?? author.alias,
                imageURL: `https://github.com/${author.alias}.png`,
            }))
            .sort((a, b) => a.url.localeCompare(b.url));

        authors.forEach((author) => {
            authorsMap[author.alias] = author;
        });
    }
    let hour = 20;
    const date = titleLineMatch.groups.release_date;
    while (publishTimes.has(`${date}T${hour}:00`)) {
        hour -= 1;
    }
    publishTimes.add(`${date}T${hour}:00`);

    const authorsMarkdown = ! authors
        ? ''
        : `authors:\n${ authors.map((author) => `  - '${ author.alias }'`).join('\n') }`

    return {
        title,
        content: [
            `---`,
            `date: ${ date }T${ hour }:00`,
            `title: ${ title }`,
            `${ authorsMarkdown }`,
            `---`,
            `# ${ title }`,
            `<!-- truncate -->`,
            `[code diff](${diffLink})`,
            `${ content.replace(/####?/g, '##') }`,
        ].filter(Boolean).join('\n')
    };
}

/**
 * @param {import('@docusaurus/types').LoadContext} context
 * @returns {import('@docusaurus/types').Plugin}
 */
async function ChangelogPlugin(context, options) {
    const generateDir = path.join(context.siteDir, 'changelog/source');
    const blogPlugin = await pluginContentBlog.default(context, {
        ...options,
        path: generateDir,
        id: 'changelog',
        blogListComponent: '@theme/ChangelogList',
        blogPostComponent: '@theme/ChangelogPage',
    });
    const changelogPath = path.join(__dirname, '../../../../../CHANGELOG.md');
    return {
        ...blogPlugin,
        name: 'docusaurus-plugin-changelog',
        async loadContent() {
            const fileContent = await fs.readFile(changelogPath, 'utf-8');
            const sanitised = fileContent
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace('@serenity-js/', '\@serenity-js/')
            ;

            const sections = sanitised
                .split(new RegExp(sectionLimitPattern))
                .map(processSection)
                .filter(Boolean);
            await Promise.all(
                sections.map((section) =>
                    fs.outputFile(
                        path.join(generateDir, `${section.title}.md`),
                        section.content,
                    ),
                ),
            );
            const authorsPath = path.join(generateDir, 'authors.json');
            await fs.outputFile(authorsPath, JSON.stringify(authorsMap, null, 2));
            const content = await blogPlugin.loadContent();
            content.blogPosts.forEach((post, index) => {
                const pageIndex = Math.floor(index / options.postsPerPage);
                post.metadata.listPageLink = normalizeUrl([
                    context.baseUrl,
                    options.routeBasePath,
                    pageIndex === 0 ? '/' : `/page/${pageIndex + 1}`,
                ]);
            });
            return content;
        },
        configureWebpack(...args) {
            const config = blogPlugin.configureWebpack(...args);
            const pluginDataDirRoot = path.join(
                context.generatedFilesDir,
                'docusaurus-plugin-changelog',
                'default',
            );
            // Redirect the metadata path to our folder
            config.module.rules[0].use[1].options.metadataPath = (mdxPath) => {
                // Note that metadataPath must be the same/in-sync as
                // the path from createData for each MDX.
                const aliasedPath = aliasedSitePath(mdxPath, context.siteDir);
                return path.join(pluginDataDirRoot, `${docuHash(aliasedPath)}.json`);
            };
            return config;
        },
        getThemePath() {
            return './theme';
        },
        getPathsToWatch() {
            // Don't watch the generated dir
            return [changelogPath];
        },
    };
}

ChangelogPlugin.validateOptions = pluginContentBlog.validateOptions;

module.exports = ChangelogPlugin;
