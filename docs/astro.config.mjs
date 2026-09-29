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
          href: 'https://github.com/interledger/rafiki-v2'
        }
      ],
      sidebar: [
        {
          label: 'Overview',
          translations: {
            es: 'Introducción'
          },
          items: [
            {
              label: 'Introducing Rhyza',
              translations: { es: 'Sobre Rhyza' },
              link: '/overview/overview'
            },
            {
              label: 'Concepts',
              translations: { es: 'Conceptos' },
              collapsed: true,
              items: [
                {
                  label: 'Financial service provider',
                  link: '/overview/concepts/financial-service-provider'
                },
                {
                  label: 'Accounting',
                  translations: { es: 'Transacciones en Rhyza' },
                  link: '/overview/concepts/accounting'
                },
                {
                  label: 'Clearing and settlement',
                  translations: { es: 'Compensación y liquidación' },
                  link: '/overview/concepts/clearing-settlement'
                },
                {
                  label: 'Interledger',
                  translations: { es: 'Interledger' },
                  link: '/overview/concepts/interledger'
                },
                {
                  label: 'Open Payments',
                  translations: { es: 'Open Payments' },
                  link: '/overview/concepts/open-payments'
                },
                {
                  label: 'Wallet addresses',
                  translations: { es: 'Wallet addresses' },
                  link: '/overview/concepts/wallet-addresses'
                }
              ]
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
              label: 'Requirements',
              collapsed: true,
              items: [
                {
                  label: 'Integration checklist',
                  link: '/integration/requirements/overview'
                },
                {
                  label: 'Assets',
                  link: '/integration/requirements/assets'
                },
                {
                  label: 'Peers',
                  link: '/integration/requirements/peers'
                },
                {
                  label: 'Wallet addresses',
                  link: '/integration/requirements/wallet-addresses'
                },
                {
                  label: 'Webhook events',
                  link: '/integration/requirements/webhook-events'
                },
                {
                  label: 'Exchange rates',
                  link: '/integration/requirements/exchange-rates'
                }
              ]
            },
            {
              label: 'Test locally',
              collapsed: true,
              items: [
                {
                  label: 'Local playground',
                  link: '/integration/playground/overview'
                }
              ]
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
              label: 'Admin API specification',
              link: '/apis/scalar/admin-api',
              attrs: {
                target: '_blank',
                rel: 'noopener noreferrer',
                'data-icon': 'external'
              }
            },
            {
              label: 'Webhooks API specification',
              link: '/apis/scalar/webhooks',
              attrs: {
                target: '_blank',
                rel: 'noopener noreferrer',
                'data-icon': 'external'
              }
            },
            {
              label: 'Identity Provider Service API specification',
              link: '/apis/scalar/idp-service-api',
              attrs: {
                target: '_blank',
                rel: 'noopener noreferrer',
                'data-icon': 'external'
              }
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
              label: 'Architecture',
              link: '/resources/architecture'
            },
            {
              label: 'Webhook event types',
              link: '/resources/webhook-event-types'
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
          exclude: ['/apis/scalar/**'],
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
