import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  languageModel,
  memory,
  tool,
  embeddings,
  expr,
  nodeJson,
  placeholder,
} from '@n8n/workflow-sdk';

// ============================================================================
// Whatsapp Cloud Booking Agent
// ----------------------------------------------------------------------------
// Transport-only swap for the previous WhatsApp chatbot. All business logic
// lives in the Supabase Edge Function `botmaker-tools` (public HTTPS, shared
// secret via header `x-botmaker-tools-secret`).
//
// Flow:
//   WhatsApp Trigger -> Normalize Inbound -> Route Inbound Text
//     (true)  -> Lookup Customer (get_customer_by_phone: primes the
//                conversation row in botmaker_* via resolveConversationRow)
//             -> Enrich Conversation -> Booking Agent (DeepSeek + tools)
//             -> Send Reply (WhatsApp Cloud API)
//     (false) -> nothing (statuses / echoes / non-text ignored)
//
// The agent calls `botmaker-tools` for every business fact and mutation via a
// single generic HTTP Request Tool. Persistence is implicit: the first tool
// call for a conversation_id find-or-creates the conversation row.
// ============================================================================

// --- 1. Inbound trigger (WhatsApp Cloud API webhook) -----------------------
const whatsAppTrigger = trigger({
  type: 'n8n-nodes-base.whatsAppTrigger',
  version: 1,
  config: {
    name: 'WhatsApp Trigger',
    parameters: { updates: ['messages'] },
    credentials: { whatsAppTriggerApi: newCredential('WhatsApp Cloud API') },
    position: [200, 300],
  },
  output: [
    {
      messages: [
        {
          from: '5491100000000',
          id: 'wamid.HBgNNTQ5MTEwMDAwMDAwMDAw',
          type: 'text',
          text: { body: 'Hola, quiero reservar un lavado' },
          timestamp: '1750000000',
        },
      ],
      contacts: [{ profile: { name: 'Juan Pérez' }, wa_id: '5491100000000' }],
    },
  ],
});

// --- 2. Normalize inbound payload -------------------------------------------
// The trigger already flattens the Meta webhook: `messages[0]`, `contacts[0]`.
// Safe optional chaining + defaults; non-text/status updates fall back to ''.
const normalizeInbound = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Normalize Inbound',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'message-text',
            name: 'messageText',
            value: expr('{{ $json.messages?.[0]?.text?.body ?? "" }}'),
            type: 'string',
          },
          {
            id: 'message-type',
            name: 'messageType',
            value: expr('{{ $json.messages?.[0]?.type ?? "" }}'),
            type: 'string',
          },
          {
            id: 'from',
            name: 'from',
            value: expr('{{ $json.messages?.[0]?.from ?? "" }}'),
            type: 'string',
          },
          {
            id: 'message-id',
            name: 'messageId',
            value: expr('{{ $json.messages?.[0]?.id ?? "" }}'),
            type: 'string',
          },
          {
            id: 'customer-name',
            name: 'customerName',
            value: expr('{{ $json.contacts?.[0]?.profile?.name ?? "" }}'),
            type: 'string',
          },
          {
            id: 'conversation-id',
            name: 'conversationId',
            value: expr('{{ $json.contacts?.[0]?.wa_id ?? $json.messages?.[0]?.from ?? "" }}'),
            type: 'string',
          },
        ],
      },
    },
    position: [420, 300],
  },
  output: [
    {
      messageText: 'Hola, quiero reservar un lavado',
      messageType: 'text',
      from: '5491100000000',
      messageId: 'wamid.HBgNNTQ5MTEwMDAwMDAwMDAw',
      customerName: 'Juan Pérez',
      conversationId: '5491100000000',
    },
  ],
});

// --- 3. Route: only inbound user text messages with a non-empty body --------
// Status updates, echoes and non-text messages have empty messageType/body and
// are silently dropped (false branch is intentionally unwired).
const routeMessage = ifElse({
  version: 2.3,
  config: {
    name: 'Route Inbound Text',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            leftValue: expr('{{ $json.messageType }}'),
            operator: { type: 'string', operation: 'equals' },
            rightValue: 'text',
          },
          {
            leftValue: expr('{{ $json.messageText }}'),
            operator: { type: 'string', operation: 'notEmpty' },
          },
        ],
        combinator: 'and',
      },
    },
    position: [640, 300],
  },
});

// --- 4. Persist path: get_customer_by_phone primes the conversation row -----
// There is no separate "persist" tool: resolveConversationRow find-or-creates
// the row keyed by conversation_id on the first call. It also tells us if the
// customer is returning.
const lookupCustomer = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Lookup Customer',
    parameters: {
      method: 'POST',
      url: placeholder('https://<project-ref>.supabase.co/functions/v1/botmaker-tools'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ { tool: "get_customer_by_phone", customer_phone: $json.from, conversation_id: $json.conversationId, customer_name: $json.customerName, is_test: false, args: {} } }}'
      ),
    },
    credentials: { httpHeaderAuth: newCredential('Botmaker Tools Secret') },
    position: [880, 300],
  },
  output: [
    {
      ok: true,
      customer_exists: true,
      customer: { id: 'cus_01J', name: 'Juan Pérez', phone: '5491100000000' },
      last_booking: null,
    },
  ],
});

// --- 5. Re-attach the conversation context for the agent --------------------
// The HTTP response replaced the item JSON; bring the normalized fields back
// (includeOtherFields keeps ok / customer_exists / customer / last_booking).
const enrichConversation = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Enrich Conversation',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'message-text',
            name: 'messageText',
            value: nodeJson(normalizeInbound, 'messageText'),
            type: 'string',
          },
          {
            id: 'from',
            name: 'from',
            value: nodeJson(normalizeInbound, 'from'),
            type: 'string',
          },
          {
            id: 'message-id',
            name: 'messageId',
            value: nodeJson(normalizeInbound, 'messageId'),
            type: 'string',
          },
          {
            id: 'customer-name',
            name: 'customerName',
            value: nodeJson(normalizeInbound, 'customerName'),
            type: 'string',
          },
          {
            id: 'conversation-id',
            name: 'conversationId',
            value: nodeJson(normalizeInbound, 'conversationId'),
            type: 'string',
          },
        ],
      },
    },
    position: [1120, 300],
  },
  output: [
    {
      ok: true,
      customer_exists: true,
      customer: { id: 'cus_01J', name: 'Juan Pérez', phone: '5491100000000' },
      last_booking: null,
      messageText: 'Hola, quiero reservar un lavado',
      from: '5491100000000',
      messageId: 'wamid.HBgNNTQ5MTEwMDAwMDAwMDAw',
      customerName: 'Juan Pérez',
      conversationId: '5491100000000',
    },
  ],
});

// --- 6. DeepSeek booking agent ----------------------------------------------
const deepSeekModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatDeepSeek',
  version: 1,
  config: {
    name: 'DeepSeek Chat Model',
    parameters: {
      model: 'deepseek-chat',
      options: { temperature: 0.3, maxTokens: 1024 },
    },
    credentials: { deepSeekApi: newCredential('DeepSeek') },
    position: [1440, 520],
  },
});

// Session memory keyed by the customer phone (stable across turns).
const sessionMemory = memory({
  type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
  version: 1.4,
  config: {
    name: 'Session Memory',
    parameters: {
      sessionIdType: 'customKey',
      sessionKey: nodeJson(enrichConversation, 'from'),
      contextWindowLength: 10,
    },
    position: [1440, 640],
  },
});

// One generic HTTP Request Tool: the agent picks the tool name + args per call.
const botmakerTool = tool({
  type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
  version: 1.1,
  config: {
    name: 'Botmaker Tools',
    parameters: {
      toolDescription:
        'Llama a la API botmaker-tools (Edge Function de Supabase) para TODA operación de negocio del bot de reservas de Washero. Método POST con body JSON: { "tool": "<nombre del tool>", "customer_phone": "<teléfono del cliente, ej. 549...>", "conversation_id": "<id estable de la conversación = mismo teléfono del cliente>", "customer_name": "<nombre del cliente, opcional>", "is_test": false, "args": { <argumentos del tool> } }. La respuesta es JSON: { "ok": true, ...datos... } o { "ok": false, "error": "...", "reason": "...", "message": "..." }; si ok es false NO reintentes una mutación, comunicá el error al cliente. Tools disponibles (nombre -> args): get_services -> {}; get_service_details -> { service_id?, service_name? }; validate_service_area -> { neighborhood, address_type? ("street" | "private_neighborhood"), private_neighborhood_name? }; get_available_dates -> { service_id, vehicle_type?, selected_extras?, date_from?, date_to? }; get_available_slots -> { date "YYYY-MM-DD", service_id, vehicle_type?, selected_extras? }; calculate_booking_price -> { service_id, vehicle_type, selected_extras?, vehicle_count? }; get_customer_by_phone -> {}; list_customer_bookings -> { limit? }; get_booking -> { booking_id }; create_booking (MUTACIÓN, solo tras confirmación explícita) -> { customer_name?, customer_email?, address, neighborhood, address_type?, private_neighborhood_name?, service_id, vehicle_type, selected_extras?, booking_units?, scheduled_date "YYYY-MM-DD", scheduled_time "HH:MM", payment_method, confirmation_message_id }; cancel_booking (MUTACIÓN) -> { booking_id }; reschedule_booking (MUTACIÓN) -> { booking_id, new_date, new_time }; request_human_handoff -> { reason }. En el body reemplazá {tool} por el nombre del tool y {args} por el objeto JSON de argumentos; los campos customer_phone, conversation_id y customer_name ya vienen precargados en el body: NO los modifiques.',
      method: 'POST',
      url: placeholder('https://<project-ref>.supabase.co/functions/v1/botmaker-tools'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '{ "tool": "{tool}", "customer_phone": "{{ $("Enrich Conversation").item.json.from }}", "conversation_id": "{{ $("Enrich Conversation").item.json.conversationId }}", "customer_name": "{{ $("Enrich Conversation").item.json.customerName }}", "is_test": false, "args": {args} }'
      ),
    },
    credentials: { httpHeaderAuth: newCredential('Botmaker Tools Secret') },
    position: [1440, 760],
  },
});

// Preserved from the previous "Whatsapp bot" workflow: MongoDB Atlas vector
// store exposed as a retrieve-as-tool so the agent can answer product-doc
// questions (services, cares, FAQs) with RAG.
const embeddingsOpenAi = embeddings({
  type: '@n8n/n8n-nodes-langchain.embeddingsOpenAi',
  version: 1.2,
  config: {
    name: 'Embeddings OpenAI',
    parameters: {
      model: 'text-embedding-3-small',
      options: {},
    },
    credentials: { openAiApi: newCredential('OpenAI') },
    position: [1440, 900],
  },
});

const productDocsTool = tool({
  type: '@n8n/n8n-nodes-langchain.vectorStoreMongoDBAtlas',
  version: 1.1,
  config: {
    name: 'MongoDB Product Docs',
    parameters: {
      mode: 'retrieve-as-tool',
      toolName: 'productDocs',
      toolDescription:
        'Busca en la documentación de productos de Washero (guías, políticas, dudas frecuentes) cuando el cliente pregunte algo que no sea una reserva: qué incluye un servicio, cuidados del vehículo, garantías, formas de pago.',
      mongoCollection: { __rl: true, mode: 'list', value: 'n8n-template', cachedResultName: 'n8n-template' },
      vectorIndexName: 'data_index',
      options: {},
    },
    subnodes: { embedding: embeddingsOpenAi },
    credentials: { mongoDb: newCredential('MongoDB') },
    position: [1440, 1020],
  },
});

const bookingAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Booking Agent',
    parameters: {
      promptType: 'define',
      text: expr('{{ $json.messageText }}'),
      options: {
        systemMessage: expr(
          'Eres el asistente virtual de reservas de Washero (lavado y detallado de autos a domicilio). Respondé SIEMPRE en español rioplatense, de forma breve, clara y amigable.\n' +
            '\n' +
            'CONTEXTO DEL CLIENTE ACTUAL:\n' +
            '- Cliente existente: {{ $json.customer_exists }}\n' +
            '- Nombre: {{ $json.customer?.name ?? "desconocido" }}\n' +
            '- Última reserva: {{ $json.last_booking ? JSON.stringify($json.last_booking) : "ninguna" }}\n' +
            '- ID del último mensaje del cliente (usar como confirmation_message_id al crear la reserva): {{ $json.messageId }}\n' +
            '\n' +
            'REGLAS OBLIGATORIAS:\n' +
            '1. Para TODA información de negocio (servicios, precios, cobertura por barrio, fechas y horarios disponibles, costo total, datos del cliente o sus reservas) llamá SIEMPRE la herramienta "Botmaker Tools" con el tool correspondiente. NUNCA inventes precios, servicios, fechas ni horarios: si no lo confirmaste con la herramienta, no lo afirmes.\n' +
            '2. El customer_phone y el conversation_id son el número de teléfono del cliente con código de país (ej. 549...). El conversation_id es el MISMO número de teléfono. El campo args de cada llamada lleva los argumentos específicos del tool (ver la descripción de la herramienta).\n' +
            '3. create_booking es una MUTACIÓN: SOLO llamala después de que el cliente confirme explícitamente un resumen completo (servicio, vehículo, dirección y barrio, fecha, hora, precio total y medio de pago). Pasá args.confirmation_message_id = ID del último mensaje del cliente (arriba).\n' +
            '4. cancel_booking y reschedule_booking también son MUTACIONES: solo con confirmación explícita, mostrando antes los datos que se van a modificar.\n' +
            '5. Si una llamada a la herramienta devuelve ok: false, leé error/reason/message, explicáselo al cliente y proponé alternativas. NO reintentes a ciegas una mutación que falló de forma ambigua.\n' +
            '6. Si no podés resolver (fallo ambiguo, cliente molesto, pedido fuera de alcance), llamá request_human_handoff con el motivo y avisá que un humano lo va a contactar.\n' +
            '7. Flujo de reserva recomendado: 1) get_services para listar servicios y precios; 2) validate_service_area con el barrio del cliente; 3) get_available_dates y get_available_slots para elegir fecha y hora; 4) calculate_booking_price; 5) resumen y pedir confirmación explícita; 6) create_booking solo tras el "sí" explícito.\n' +
            '8. Podés usar la herramienta "MongoDB Product Docs" para consultar documentación de productos de Washero cuando el cliente pregunte algo que no sea una reserva (qué incluye un servicio, cuidados, garantías, dudas frecuentes).'
        ),
        maxIterations: 15,
        enableStreaming: false,
      },
    },
    subnodes: {
      model: deepSeekModel,
      memory: sessionMemory,
      tools: [botmakerTool, productDocsTool],
    },
    position: [1440, 300],
  },
  output: [
    {
      output: '¡Hola Juan! Claro, te ayudo a reservar. ¿Qué servicio te interesa?',
      from: '5491100000000',
      messageText: 'Hola, quiero reservar un lavado',
    },
  ],
});

// --- 7. Send the reply back via the WhatsApp Cloud API ----------------------
const sendReply = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Reply',
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: placeholder('Your WhatsApp Business Phone Number ID (e.g. 1327924187062435)'),
      recipientPhoneNumber: expr('{{ $json.from.replace(/^549/, "54") }}'),
      messageType: 'text',
      textBody: expr('{{ $json.output }}'),
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud') },
    position: [1720, 300],
  },
  output: [
    {
      contacts: [{ input: '5491100000000', wa_id: '5491100000000' }],
      messages: [{ id: 'wamid.EABhNzg2MDAwMDAw' }],
      messaging_product: 'whatsapp',
    },
  ],
});

// --- Setup note (guidance for whoever imports this) -------------------------
const configNote = sticky(
  '## Configuración antes de activar\n' +
    '- **URL botmaker-tools**: reemplazar `<project-ref>` por el ref real del proyecto Supabase en "Lookup Customer" y en el tool "Botmaker Tools".\n' +
    '- **Credenciales a conectar**: whatsAppTriggerApi (trigger), whatsAppApi (Send Reply), httpHeaderAuth con header `x-botmaker-tools-secret` (Lookup Customer + Botmaker Tools), deepSeekApi (modelo), mongoDb + openAiApi (RAG).\n' +
    '- **Phone Number ID**: completar en "Send Reply".\n' +
    '- El destinatario usa `from` con normalización 549 -> 54 (mismo comportamiento que el flujo anterior).',
  [normalizeInbound, routeMessage],
  { color: 4 }
);

// ============================================================================
// Workflow composition
// ============================================================================
export default workflow('whatsapp-cloud-booking-agent', 'Whatsapp Cloud Booking Agent')
  .add(whatsAppTrigger)
  .to(
    normalizeInbound.to(
      routeMessage.onTrue(
        lookupCustomer.to(enrichConversation.to(bookingAgent.to(sendReply)))
      )
    )
  )
  .add(configNote)
  .group('Ingest & Route', [normalizeInbound, routeMessage], {
    description: 'Normaliza el payload entrante y filtra solo mensajes de texto de usuarios.',
  })
  .group(
    'Booking Agent',
    [lookupCustomer, enrichConversation, bookingAgent, deepSeekModel, sessionMemory, botmakerTool, productDocsTool, embeddingsOpenAi],
    {
      description: 'Persiste la conversación (get_customer_by_phone) y ejecuta el agente DeepSeek con las tools de botmaker-tools.',
    }
  )
  .group('Send Reply', [sendReply], {
    description: 'Responde al cliente por WhatsApp Cloud API.',
  });
