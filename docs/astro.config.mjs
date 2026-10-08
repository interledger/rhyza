import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

import remarkMath from 'remark-math'
import rehypeMathjax from 'rehype-mathjax'
import starlightLinksValidator from 'starlight-links-validator'
import starlightFullViewMode from 'starlight-fullview-mode'
import { unified, rehypeHeadingIds } from '@astrojs/markdown-remark'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'

// https://astro.build/config
export default defineConfig({
  site: 'https://rhyza.dev',
  outDir: './build',
  // The three specs had a page each before they merged onto /apis/.
  redirects: {
    '/apis/scalar/admin-api': '/apis/#tag/admin-api-overview',
    '/apis/scalar/webhooks': '/apis/#tag/webhooks-api-overview',
    '/apis/scalar/idp-service-api':
      '/apis/#tag/identity-provider-service-api-overview'
  },
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [
        rehypeMathjax,
        rehypeHeadingIds,
        [
          rehypeAutolinkHeadings,
          {
            behavior: 'wrap'
          }
        ]
      ]
    })
  },
  integrations: [
    starlight({
      title: 'Rhyza',
      description:
        "Rhyza is open source software that allows a financial service provider to enable Interledger functionality on its users' accounts.",
      customCss: ['./src/styles/rhyza.css'],
      expressiveCode: {
        styleOverrides: {
          borderColor: 'transparent',
          borderRadius: 'var(--border-radius)'
        }
      },
      components: {
        PageSidebar: './src/components/PageSidebar.astro',
        Footer: './src/components/Footer.astro',
        PageTitle: './src/components/PageTitle.astro',
        LastUpdated: './src/components/LastUpdated.astro'
      },
      lastUpdated: true,
      defaultLocale: 'root',
      locales: {
        root: {
          label: 'English',
          lang: 'en'
        },
        es: {
          label: 'Español'
        }
      },
      head: [
        {
          tag: 'script',
          attrs: {
            src: '/scripts.js',
            defer: true
          }
        },
        {
          tag: 'script',
          attrs: {
            defer: true,
            'data-website-id': '75fba178-7dca-4874-adc9-50cf85c83528',
            src: 'https://uwa.interledger.org/script.js',
            'data-domains': 'rafiki.dev'
          }
        }
      ],
      logo: {
        light: './src/assets/light-logo.svg',
        dark: './src/assets/dark-logo.svg',
        replacesTitle: true
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/interledger/rhyza'
        }
      ],
      sidebar: [
        {
          label: 'Overview',
          translations: { es: 'Introducción' },
          link: 'overview'
        },
        {
          label: 'Architecture',
          link: '/architecture'
        },
        {
          label: 'Concepts',
          translations: {
            es: 'Conceptos'
          },
          collapsed: true,
          items: [
            {
              label: 'Financial service provider',
              link: '/concepts/financial-service-provider'
            },
            {
              label: 'Accounting',
              translations: { es: 'Transacciones en Rhyza' },
              link: '/concepts/accounting'
            },
            {
              label: 'Clearing and settlement',
              translations: { es: 'Compensación y liquidación' },
              link: '/concepts/clearing-settlement'
            },
            {
              label: 'Interledger',
              translations: { es: 'Interledger' },
              link: '/concepts/interledger'
            },
            {
              label: 'Open Payments',
              translations: { es: 'Open Payments' },
              link: '/concepts/open-payments'
            },
            {
              label: 'Wallet addresses',
              translations: { es: 'Wallet addresses' },
              link: '/concepts/wallet-addresses'
            }
          ]
        },
        {
          label: 'Integration',
          collapsed: true,
          items: [
            {
              label: 'Overview',
              link: '/integration/overview'
            },
            {
              label: 'Integration checklist',
              link: '/integration/checklist'
            },
            {
              label: 'Test locally',
              link: '/integration/testlocal'
            }
          ]
        },
        {
          label: 'API Specifications',
          collapsed: true,
          items: [
            {
              label: 'Overview',
              link: '/apis/api-overview'
            },
            {
              label: 'Admin API',
              link: '/apis/#tag/admin-api-overview'
            },
            {
              label: 'Identity Provider Service API',
              link: '/apis/#tag/identity-provider-service-api-overview'
            },
            {
              label: 'Webhooks API',
              link: '/apis/#tag/webhooks-api-overview'
            }
          ]
        },
        {
          label: 'Resources',
          collapsed: true,
          items: [
            {
              label: 'Glossary',
              link: '/resources/glossary'
            },
            {
              label: 'Get involved',
              link: '/resources/get-involved'
            }
          ]
        }
      ],
      plugins: [
        starlightLinksValidator({
          // The API reference is a custom page, which the validator cannot see
          // into. /apis/api-overview/ is a docs page and stays validated.
          exclude: ['/apis/', '/apis/#*/**'],
          errorOnLocalLinks: false,
          errorOnFallbackPages: false,
          errorOnInvalidHashes: false
        }),
        starlightFullViewMode({
          leftSidebarEnabled: true,
          rightSidebarEnabled: true
        })
      ]
    })
  ],
  server: {
    port: 1101
  }
})
