import {
  CONTROLLER_ADDRESS,
  CONTROLLER_NAME,
  CONTROLLER_TAX_ID,
  LegalDocument,
  PRIVACY_CONTACT_EMAIL,
  TERMS_PATH,
} from '@/components/legal/LegalDocument'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidade — Oilio',
  description: 'Como o Oilio trata dados pessoais, em conformidade com a LGPD.',
}

export default function PrivacyPage() {
  return (
    <LegalDocument title="Política de Privacidade">
      <p>
        Esta política explica como o Oilio trata dados pessoais, nos termos da Lei Geral de Proteção
        de Dados Pessoais (Lei 13.709/2018, LGPD). Ela vale para o site, o aplicativo e o
        agendamento online dos estabelecimentos que usam o Oilio.
      </p>

      <h2>1. Quem somos e qual o nosso papel</h2>
      <p>
        O Oilio é operado por {CONTROLLER_NAME}, inscrita no CNPJ {CONTROLLER_TAX_ID}, com sede em{' '}
        {CONTROLLER_ADDRESS}.
      </p>
      <ul>
        <li>
          <strong>Controlador</strong>: somos controladores dos dados das contas na plataforma
          (donos de negócio, equipe e clientes que criam conta para agendar).
        </li>
        <li>
          <strong>Operador</strong>: quanto aos dados que cada estabelecimento registra sobre os
          próprios clientes e atendimentos, o estabelecimento é o controlador e o Oilio trata esses
          dados em nome dele, conforme as instruções dele.
        </li>
      </ul>

      <h2>2. Dados que tratamos</h2>
      <ul>
        <li>
          <strong>Conta</strong>: nome, e-mail e foto vindos do login com Google; celular (WhatsApp)
          e data de nascimento informados por você.
        </li>
        <li>
          <strong>Uso do serviço</strong>: agendamentos, atendimentos, comandas, assinaturas,
          pagamentos e demais registros feitos no app.
        </li>
        <li>
          <strong>Dados do negócio</strong>: nome, unidades, endereço, dados fiscais e de
          faturamento do estabelecimento.
        </li>
        <li>
          <strong>Dados técnicos</strong>: registros de acesso exigidos pelo Marco Civil da
          Internet, informações de erro do aplicativo e métricas de audiência sem identificação
          pessoal.
        </li>
      </ul>
      <p>Não pedimos dados sensíveis e não armazenamos dados de cartão de pagamento.</p>

      <h2>3. Finalidades e bases legais</h2>
      <ul>
        <li>Criar e manter sua conta e prestar o serviço: execução de contrato (Art. 7º, V).</li>
        <li>
          Permitir agendamentos e a comunicação entre você e o estabelecimento: execução de contrato
          (Art. 7º, V).
        </li>
        <li>
          Cobrança e faturamento da assinatura do Oilio: execução de contrato e cumprimento de
          obrigação legal (Art. 7º, II e V).
        </li>
        <li>
          Guardar registros de acesso e documentos fiscais: cumprimento de obrigação legal (Art. 7º,
          II).
        </li>
        <li>
          Segurança, prevenção a fraude, correção de erros e melhoria do serviço: legítimo interesse
          (Art. 7º, IX), sempre limitado ao necessário.
        </li>
      </ul>

      <h2>4. Compartilhamento</h2>
      <p>Não vendemos dados pessoais. Compartilhamos apenas o necessário com:</p>
      <ul>
        <li>
          <strong>O estabelecimento</strong> com que você agenda ou do qual faz parte, que vê os
          dados necessários para atender você.
        </li>
        <li>
          <strong>Operadores que nos prestam serviço</strong>, sob contrato e só para as finalidades
          acima: Vercel (hospedagem e medição de audiência sem identificação pessoal), Supabase
          (banco de dados e autenticação), Stripe (pagamentos) e Sentry (monitoramento de erros).
          Também usamos o login do Google, quando você escolhe entrar com ele.
        </li>
        <li>
          <strong>Autoridades</strong>, quando houver obrigação legal ou ordem judicial.
        </li>
      </ul>
      <p>
        Alguns operadores podem tratar dados fora do Brasil. Nesses casos, a transferência segue o
        Art. 33 da LGPD, com garantias contratuais de proteção.
      </p>

      <h2>5. Cookies</h2>
      <p>
        Usamos apenas cookies essenciais: os que mantêm você conectado com segurança e os que
        guardam preferências de uso, como a unidade selecionada. Não usamos cookies de publicidade.
        A medição de audiência é feita sem cookies e sem identificar você.
      </p>

      <h2>6. Retenção e eliminação</h2>
      <p>
        Mantemos os dados enquanto a conta estiver ativa ou enquanto forem necessários para as
        finalidades acima. Depois disso, eliminamos ou anonimizamos os dados, salvo o que a lei
        obriga a guardar (por exemplo, registros de acesso por 6 meses e documentos fiscais pelo
        prazo legal). Dados tratados em nome de um estabelecimento seguem as instruções dele.
      </p>

      <h2>7. Seus direitos</h2>
      <p>Nos termos do Art. 18 da LGPD, você pode pedir:</p>
      <ul>
        <li>confirmação de que tratamos seus dados e acesso a eles;</li>
        <li>correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;</li>
        <li>portabilidade dos dados;</li>
        <li>informação sobre com quem compartilhamos seus dados;</li>
        <li>eliminação dos dados e revogação de consentimento, quando for o caso;</li>
        <li>revisão de decisões tomadas só por meios automatizados.</li>
      </ul>
      <p>
        Parte desses pedidos pode ser feita direto no app, em Configurações › Privacidade. Para os
        demais, ou se o pedido envolver dados de um estabelecimento, fale com o nosso encarregado.
        Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).
      </p>

      <h2>8. Segurança</h2>
      <p>
        Adotamos medidas técnicas e administrativas para proteger os dados contra acesso não
        autorizado, perda ou alteração. Se ocorrer um incidente que possa trazer risco relevante,
        avisaremos os titulares afetados e a ANPD.
      </p>

      <h2>9. Crianças e adolescentes</h2>
      <p>O Oilio não é destinado a menores de 18 anos.</p>

      <h2>10. Encarregado e contato</h2>
      <p>Encarregado pelo tratamento de dados pessoais: {PRIVACY_CONTACT_EMAIL}.</p>

      <h2>11. Alterações</h2>
      <p>
        Podemos atualizar esta política. A data no topo indica a versão vigente; mudanças relevantes
        serão avisadas no app. Veja também os <a href={TERMS_PATH}>Termos de Uso</a>.
      </p>
    </LegalDocument>
  )
}
