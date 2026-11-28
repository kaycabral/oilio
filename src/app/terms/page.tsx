import {
  CONTROLLER_NAME,
  CONTROLLER_TAX_ID,
  JURISDICTION,
  LegalDocument,
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_PATH,
} from '@/components/legal/LegalDocument'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Termos de Uso — Oilio',
  description: 'Termos de Uso da plataforma Oilio.',
}

export default function TermsPage() {
  return (
    <LegalDocument title="Termos de Uso">
      <p>
        Estes termos regem o uso do Oilio, plataforma de gestão para negócios de serviço recorrente
        operada por {CONTROLLER_NAME} (CNPJ {CONTROLLER_TAX_ID}). Ao criar uma conta ou usar o
        serviço, você concorda com eles e com a <a href={PRIVACY_PATH}>Política de Privacidade</a>.
      </p>

      <h2>1. O serviço</h2>
      <p>
        O Oilio oferece ferramentas de agenda, atendimento, comandas, assinaturas, equipe e finanças
        para estabelecimentos, além de agendamento online para os clientes deles. Funcionalidades
        podem mudar com o tempo.
      </p>

      <h2>2. Conta</h2>
      <ul>
        <li>Você precisa ter 18 anos ou mais e informar dados verdadeiros.</li>
        <li>Você é responsável pelo acesso à sua conta e pelo que é feito nela.</li>
        <li>
          Donos de negócio respondem pelos membros da equipe que convidam e pelos papéis que
          atribuem.
        </li>
      </ul>

      <h2>3. Responsabilidades do estabelecimento</h2>
      <p>
        O estabelecimento é responsável pelos serviços que presta aos próprios clientes, pelos
        preços, pela emissão de documentos fiscais e pelos dados de clientes que registra no Oilio,
        devendo ter base legal para tratá-los e atender aos pedidos dos titulares.
      </p>

      <h2>4. Uso permitido</h2>
      <p>É proibido:</p>
      <ul>
        <li>usar o Oilio para fins ilícitos ou para enviar mensagens não solicitadas;</li>
        <li>tentar acessar dados de outras contas ou estabelecimentos;</li>
        <li>interferir no funcionamento ou na segurança da plataforma;</li>
        <li>copiar, revender ou fazer engenharia reversa do serviço.</li>
      </ul>

      <h2>5. Planos e pagamento</h2>
      <p>
        Há um plano gratuito e planos pagos, com preços publicados na página de preços. Planos pagos
        são cobrados de forma recorrente até o cancelamento, que pode ser feito a qualquer momento e
        vale a partir do próximo ciclo.
      </p>

      <h2>6. Disponibilidade</h2>
      <p>
        Buscamos manter o serviço disponível, mas pode haver interrupções para manutenção ou por
        causas fora do nosso controle.
      </p>

      <h2>7. Encerramento</h2>
      <p>
        Você pode encerrar sua conta quando quiser. Podemos suspender ou encerrar contas que violem
        estes termos. Após o encerramento, os dados seguem o previsto na Política de Privacidade.
      </p>

      <h2>8. Limitação de responsabilidade</h2>
      <p>
        Nos limites da lei, o Oilio não responde por danos indiretos nem por perdas decorrentes do
        uso indevido da plataforma por usuários ou estabelecimentos. Nada nestes termos afasta
        direitos garantidos pelo Código de Defesa do Consumidor.
      </p>

      <h2>9. Alterações</h2>
      <p>
        Podemos atualizar estes termos. A data no topo indica a versão vigente; mudanças relevantes
        serão avisadas no app com antecedência.
      </p>

      <h2>10. Lei e foro</h2>
      <p>
        Estes termos seguem a lei brasileira. Fica eleito o foro da comarca de {JURISDICTION},
        ressalvado o foro do domicílio do consumidor.
      </p>

      <h2>11. Contato</h2>
      <p>Dúvidas sobre estes termos: {PRIVACY_CONTACT_EMAIL}.</p>
    </LegalDocument>
  )
}
