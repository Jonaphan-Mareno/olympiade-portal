import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Olympiad Portal',
  tagline: 'Documentation for the test taking and administration platform',
  favicon: 'img/icon-v2.png',

  themes: ['@docusaurus/theme-mermaid'],
  markdown: {
    mermaid: true,
  },

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://thabiso-thuso.github.io',  
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/Olympiad-Documentation/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'Thabiso-Thuso', // Usually your GitHub org/user name.
  projectName: 'Olympiad-Documentation', // Usually your repo name.
  // GitHub Pages serves directory index files; trailing slashes keep deep
  // links (e.g. /docs/Quality%20Assurance/testing-documentation/) resolvable
  // on direct load. See https://github.com/facebook/docusaurus/discussions/9546
  trailingSlash: true,
  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // "Edit this page" links are disabled until the docs are published
          // from the team's repository.
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Used as the social card for link previews
    image: 'img/social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Olympiad Portal',
      logo: {
        alt: 'Olympiad Portal logo',
        src: 'img/icon-v2.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://olympiad-portal-eta.vercel.app',
          label: 'Live Portal',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Tech Stack',
              to: '/docs/Technical Documentation/tech-stack',
            },
            {
              label: 'Feature Overview',
              to: '/docs/Technical Documentation/features',
            },
            {
              label: 'API Guide',
              to: '/docs/Technical Documentation/app-api',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'Live Portal',
              href: 'https://olympiad-portal-eta.vercel.app',
            },
            {
              label: 'Task Board (Gitea)',
              href: 'https://sdp.ms.wits.ac.za/edgecaserunners/Olympiad-Portal/projects/29',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Olympiad Portal. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;