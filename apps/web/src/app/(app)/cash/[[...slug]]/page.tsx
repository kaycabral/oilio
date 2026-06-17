import { redirect } from 'next/navigation'

// Brief 0031 (#1062): caixa colapsou no hub `/reports`. Qualquer `/cash`* legado
// (incl. `/cash/categories`, `/cash/report`) reencaminha pro hub — migração
// graciosa de URL, sem 404 em links antigos.
export default function CashRedirect() {
  redirect('/reports')
}
