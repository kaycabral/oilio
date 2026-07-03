// Two retail isolation orgs — "Pizzaria do Tonho" and "Comércio Esquina" —
// each fully self-contained under its own orgId, with closed sales. They exist
// to make multi-org isolation visible and testable locally (no data crosses
// from the Barbearia or from each other).

import { seedRetailOrg } from './retail-org'

const PIZZARIA = 'seed-org-pizzaria'
const COMERCIO = 'seed-org-comercio'

export async function seedPizzaria(): Promise<void> {
  await seedRetailOrg({
    orgId: PIZZARIA,
    orgName: 'Pizzaria do Tonho',
    slug: 'pizzaria-do-tonho',
    owner: {
      uid: 'seed-owner-pizzaria',
      email: 'tonho@cbrl.local',
      displayName: 'Tonho',
      mobile: '5511955550000',
      login: false,
    },
    unitId: 'seed-unit-pizzaria',
    unitName: 'Salão',
    // Disjoint mobile range per org (global uniqueness on users.mobile).
    customerMobileBase: 700000,
    products: [
      { id: 'pizza-marguerita', name: 'Pizza Marguerita', priceCents: 4500, stock: 100 },
      { id: 'pizza-calabresa', name: 'Pizza Calabresa', priceCents: 4800, stock: 100 },
      { id: 'pizza-portuguesa', name: 'Pizza Portuguesa', priceCents: 5200, stock: 100 },
      { id: 'refri-lata', name: 'Refrigerante Lata', priceCents: 700, stock: 200 },
      { id: 'agua-mineral', name: 'Água Mineral', priceCents: 400, stock: 200 },
    ],
    customerCount: 6,
    sales: [
      {
        orderId: 'pizzaria-sale-1',
        customerId: `${PIZZARIA}-cust-0`,
        productIds: ['pizza-marguerita', 'refri-lata'],
      },
      {
        orderId: 'pizzaria-sale-2',
        customerId: `${PIZZARIA}-cust-1`,
        productIds: ['pizza-calabresa', 'pizza-portuguesa', 'refri-lata'],
      },
      {
        orderId: 'pizzaria-sale-3',
        customerId: `${PIZZARIA}-cust-2`,
        productIds: ['pizza-portuguesa', 'agua-mineral'],
      },
      {
        orderId: 'pizzaria-sale-4',
        customerId: `${PIZZARIA}-cust-3`,
        productIds: ['pizza-marguerita', 'pizza-calabresa'],
      },
    ],
  })
}

export async function seedComercio(): Promise<void> {
  await seedRetailOrg({
    orgId: COMERCIO,
    orgName: 'Comércio Esquina',
    slug: 'comercio-esquina',
    owner: {
      uid: 'seed-owner-comercio',
      email: 'esquina@cbrl.local',
      displayName: 'Dona Esquina',
      mobile: '5511944440000',
      login: false,
    },
    unitId: 'seed-unit-comercio',
    unitName: 'Loja',
    // Disjoint mobile range per org (global uniqueness on users.mobile).
    customerMobileBase: 710000,
    products: [
      { id: 'arroz-5kg', name: 'Arroz 5kg', priceCents: 2500, stock: 80 },
      { id: 'feijao-1kg', name: 'Feijão 1kg', priceCents: 900, stock: 120 },
      { id: 'oleo-soja', name: 'Óleo de Soja', priceCents: 700, stock: 60 },
      { id: 'cafe-500g', name: 'Café 500g', priceCents: 1800, stock: 90 },
      { id: 'acucar-1kg', name: 'Açúcar 1kg', priceCents: 600, stock: 150 },
    ],
    customerCount: 5,
    sales: [
      {
        orderId: 'comercio-sale-1',
        customerId: `${COMERCIO}-cust-0`,
        productIds: ['arroz-5kg', 'feijao-1kg', 'oleo-soja'],
      },
      {
        orderId: 'comercio-sale-2',
        customerId: `${COMERCIO}-cust-1`,
        productIds: ['cafe-500g', 'acucar-1kg'],
      },
      {
        orderId: 'comercio-sale-3',
        customerId: `${COMERCIO}-cust-2`,
        productIds: ['arroz-5kg', 'acucar-1kg'],
      },
      {
        orderId: 'comercio-sale-4',
        customerId: `${COMERCIO}-cust-3`,
        productIds: ['feijao-1kg', 'oleo-soja', 'cafe-500g'],
      },
    ],
  })
}
