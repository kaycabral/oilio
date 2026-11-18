'use client'

import { Button } from '@oilio/design'
import { useState } from 'react'
import { toast } from 'sonner'

export function CopyPublicUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Não foi possível copiar — copie manualmente')
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} className="w-fit">
      {copied ? 'Copiado!' : 'Copiar link'}
    </Button>
  )
}
