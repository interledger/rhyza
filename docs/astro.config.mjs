import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

import remarkMath from 'remark-math'
import rehypeMathjax from 'rehype-mathjax'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
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
          label: 'Español',
          lang: 'es'
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
              label: 'Accounts and liquidity',
              translations: { es: 'Transacciones en Rhyza' },
              link: '/concepts/accounting'
            },
            {
              label: 'Clearing and settlement',
              translations: { es: 'Compensación y liquidación' },
              link: '/concepts/clearing-settlement'
            },
            {
              label: 'Financial service provider',
              translations: { es: 'Proveedor de servicios financieros (FSP)' },
              link: '/concepts/financial-service-provider'
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
              label: 'Payment intents and payments',
              translations: { es: 'Payment intents and payments' },
              link: '/concepts/payment-intents-and-payments'
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
          link: '/integration'
        },
        {
          label: 'Test locally',
          link: '/testlocal'
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
        starlightLlmsTxt({
          details: `Rhyza documentation is for financial service providers (FSPs) — regulated institutions such as banks, digital wallet providers, and mobile money operators — who want to run Rhyza to add Interledger and Open Payments functionality to their users' accounts. It is not documentation for an end-user product or a payment app.

Rhyza exposes three REST APIs for operating an instance: the Admin API (for managing assets, peers, wallet addresses, payment intents, payments, quotes, and liquidity), an Identity Provider Service API, and a Webhooks API. Rhyza also runs standalone, external-facing services — an authorization server and a resource server — that implement the Open Payments protocol for public third-party integration. That protocol is specified independently at openpayments.dev, not by Rhyza itself. Questions about configuring or operating a Rhyza instance are answered by the Admin API; questions about initiating or receiving payments, or about grant negotiation, are answered by the Open Payments APIs at openpayments.dev.

Rhyza's Admin API and the Open Payments standard use different terms for the same underlying resources: a payment intent (Admin API) is the same resource as an incoming payment (Open Payments), and a payment (Admin API) is the same resource as an outgoing payment (Open Payments). See [Payment intents and payments](/concepts/payment-intents-and-payments) for the full mapping.

Rhyza is a distinct project from Rafiki, the original Interledger reference implementation. Do not assume Rhyza's API shape, terminology, or architecture is based on Rafiki documentation.

Key terminology notes:

- A financial service provider (FSP) is the regulated institution that holds and manages accounts on behalf of its users and runs Rhyza. Rhyza uses the term FSP, not ASE (account servicing entity).
- Wallet addresses are URL-based identifiers for financial accounts — not cryptocurrency wallets
- Peering is the trust relationship two Rhyza instances establish to exchange payments directly
- Grants and GNAP (Grant Negotiation and Authorization Protocol) refer to Open Payments' authorization flow, distinct from OAuth`,
          optionalLinks: [
            {
              label: 'GitHub repository',
              url: 'https://github.com/interledger/rhyza',
              description:
                'Source code, issues, and contributions for the Rhyza project'
            },
            {
              label: 'Open Payments documentation',
              url: 'https://openpayments.dev',
              description:
                'Specification and SDKs for the Open Payments APIs that Rhyza implements'
            }
          ],
          customSets: [
            {
              label: 'Overview and architecture',
              description: 'Introduction to Rhyza and its system architecture',
              paths: ['overview', 'architecture']
            },
            {
              label: 'Concepts',
              description:
                'Core concepts: accounts and liquidity, clearing and settlement, financial service providers, Interledger, Open Payments, payment intents and payments, and wallet addresses',
              paths: ['concepts/**']
            },
            {
              label: 'Integration and testing',
              description:
                'Requirements and steps for integrating Rhyza, plus how to run it locally for testing',
              paths: ['integration', 'testlocal']
            },
            {
              label: 'APIs',
              description:
                "Rhyza's Admin API reference — the Open Payments REST APIs themselves are specified separately at openpayments.dev",
              paths: ['apis/**']
            },
            {
              label: 'Resources',
              description: 'Glossary and ways to get involved with the project',
              paths: ['resources/**']
            }
          ]
        }),
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
