// Public layout — sem dependência de sessão. As páginas dentro de `(public)/`
// são acessadas por clientes finais (não-autenticados) via /[slug]. Mantemos
// o RootLayout para fonts/theme/toast e adicionamos só um wrapper neutro pra
// não herdar o app shell autenticado de `(app)`.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-background text-foreground min-h-screen">{children}</div>
}
