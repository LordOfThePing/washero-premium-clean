import { workflow, node, trigger, sticky, ifElse, expr } from '@n8n/workflow-sdk';


const inboundWebhook = trigger({
  type: 'n8n-nodes-base.whatsAppTrigger',
  version: 1,
  config: {
    name: 'Washero WhatsApp Inbound Webhook',
    parameters: { updates: ['messages'], options: {} },
    credentials: { whatsAppTriggerApi: { id: 'hHrurmN4v9WnC6wk', name: 'WhatsApp OAuth account' } },
    position: [-260, 0],
  },
  output: [{ messages: [{ from: '5491122334455', id: 'wamid.ABC', type: 'text', text: { body: 'hola' } }], contacts: [{ profile: { name: 'Pedro' } }] }],
});

const normalizeInbound = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Inbound',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const out = [];\nfor (const item of $input.all()) {\n  const j = item.json || {};\n  const m = (j.messages && j.messages[0]) || {};\n  const c = (j.contacts && j.contacts[0]) || {};\n  const inter = m.interactive || {};\n  const br = inter.button_reply || {};\n  const lr = inter.list_reply || {};\n  const body = (m.text && m.text.body) || (m.image && m.image.caption) || (m.document && m.document.caption) || lr.title || br.title || '';\n  out.push({ json: {\n    phone: String(m.from || ''),\n    name: String((c.profile && c.profile.name) || ''),\n    conversation_id: String(m.from || ''),\n    message_type: String(m.type || 'unknown'),\n    message_text: String(body),\n    reply_id: String(lr.id || br.id || ''),\n    reply_title: String(lr.title || br.title || ''),\n    external_message_id: String(m.id || ''),\n    media_id: String((m.image && m.image.id) || (m.document && m.document.id) || (m.audio && m.audio.id) || '')\n  } });\n}\nreturn out;",
    },
    position: [-40, 0],
  },
  output: [{ phone: '5491122334455', name: 'Pedro', conversation_id: '5491122334455', message_type: 'text', message_text: 'hola', reply_id: '', reply_title: '', external_message_id: 'wamid.ABC', media_id: '' }],
});

const ingestInbound = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Ingest Inbound Message',
    parameters: {
      method: 'POST',
      url: 'https://apiwashero.flynnpedroa.engineer/functions/v1/whatsapp-tools',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { tool: "ingest_message", customer_phone: $json.phone, conversation_id: $json.conversation_id, customer_name: $json.name, is_test: false, args: { direction: "inbound", sender_type: "user", message_type: $json.message_type, message_text: $json.message_text, external_message_id: $json.external_message_id } } }}'),
      options: {},
    },
    credentials: { httpHeaderAuth: { id: 'DHxWaDoMvPTw5sjQ', name: 'Inbound Auth' } },
    position: [180, 0],
  },
  output: [{ ok: true, should_bot_reply: true, is_first_inbound: true }],
});

const shouldBotReply = ifElse({
  version: 2.3,
  config: {
    name: 'Should Bot Reply?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.should_bot_reply }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: '' }],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    position: [400, 0],
  },
});

const getState = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Get Conversation State',
    parameters: {
      method: 'POST',
      url: 'https://apiwashero.flynnpedroa.engineer/functions/v1/whatsapp-tools',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { tool: "get_conversation_state", customer_phone: $("Normalize Inbound").first().json.phone, conversation_id: $("Normalize Inbound").first().json.conversation_id, customer_name: $("Normalize Inbound").first().json.name, is_test: false, args: {} } }}'),
      options: {},
    },
    credentials: { httpHeaderAuth: { id: 'DHxWaDoMvPTw5sjQ', name: 'Inbound Auth' } },
    position: [620, -100],
  },
  output: [{ ok: true, state: 'none', data: {} }],
});

const part1_0 =
  "// ============================================================================\n// Washero WhatsApp booking flow - deterministic state machine (no LLM).\n// Pure function of (state, data, tapped button / typed text, tool results so far).\n// Emits either { action: 'call' } to ask for one more tool result, or\n// { action: 'reply' } with the next state and the single outgoing message.\n// ============================================================================\nconst norm = $('Normalize Inbound').first().json || {};\nconst inp = $input.first().json || {};\n\nconst to = String(norm.phone || '').replace(/^549/, '54');\nconst state0 = String(inp.state || 'none');\nconst data0 = (inp.data && typeof inp.data === 'object') ? inp.data : {};\nconst results = Array.isArray(inp.results) ? inp.results : [];\n\nconst rid = String(norm.reply_id || '');\nconst rtitle = String(norm.reply_title || '');\nconst mtype = String(norm.message_type || 'text');\nconst text = String(norm.message_text || '').trim();\nconst low = text.toLowerCase();\n\nconst MAX_TOOL_CALLS = 8;\nconst VEHICLES = ['Auto', 'SUV', 'Pick-up', 'Otro'];\n\nfunction cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\\u2026' : s; }\nfunction money(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR'); }\nconst DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];\nconst MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];\nfunction fmtDate(iso) {\n  const p = String(iso || '').split('-');\n  if (p.length !== 3) return String(iso || '');\n  const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));\n  return DIAS[d.getUTCDay()] + ' ' + Number(p[2]) + ' ' + MESES[Number(p[1]) - 1];\n}\nfunction fmtTime(t) { return String(t || '').slice(0, 5); }\n\nfunction msgText(body) {\n  return { payload: { messaging_product: 'whatsapp', to: to, type: 'text', text: { preview_url: true, body: cut(body, 3500) } }, log_text: body };\n}\nfunction msgButtons(body, btns, header) {\n  const bs = btns.slice(0, 3).map(function (b) { return { type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } }; });\n" +
  "  const inter = { type: 'button', body: { text: cut(body, 1024) }, action: { buttons: bs } };\n  if (header) inter.header = { type: 'text', text: cut(header, 60) };\n  const log = body + '\\n' + bs.map(function (b) { return '[' + b.reply.title + ']'; }).join(' ');\n  return { payload: { messaging_product: 'whatsapp', to: to, type: 'interactive', interactive: inter }, log_text: log };\n}\nfunction msgList(body, buttonLabel, rows, header, sectionTitle) {\n  const rs = rows.slice(0, 10).map(function (r) {\n    const o = { id: cut(r.id, 200), title: cut(r.title, 24) };\n    if (r.description) o.description = cut(r.description, 72);\n    return o;\n  });\n  const inter = { type: 'list', body: { text: cut(body, 1024) }, action: { button: cut(buttonLabel || 'Ver opciones', 20), sections: [{ title: cut(sectionTitle || 'Opciones', 24), rows: rs }] } };\n  if (header) inter.header = { type: 'text', text: cut(header, 60) };\n  const log = body + '\\n' + rs.map(function (r) { return '- ' + r.title; }).join('\\n');\n  return { payload: { messaging_product: 'whatsapp', to: to, type: 'interactive', interactive: inter }, log_text: log };\n}\n\nfunction callTool(tool, args) {\n  return [{ json: { action: 'call', tool: tool, args: args || {}, state: state0, data: data0, results: results } }];\n}\nfunction reply(nextState, nextData, msg) {\n  return [{ json: {\n    action: 'reply',\n    next_state: nextState,\n    next_data: nextData || {},\n    payload: msg ? msg.payload : null,\n    log_text: msg ? msg.log_text : '',\n    has_message: msg ? true : false\n  } }];\n}\n// Results are addressed by tool name, not position, so a step can add a call\n// anywhere in its chain without renumbering the ones after it.\nfunction byTool(name) {\n  for (let i = results.length - 1; i >= 0; i--) {\n    if (results[i] && results[i].tool === name) return results[i].result;\n  }\n  return null;\n}\nfunction ridVal(prefix) { return rid.indexOf(prefix + ':') === 0 ? rid.slice(prefix.length + 1) : null; }\n\n" +
  "const MENU_ROWS = [\n  { id: 'menu:reservar', title: 'Reservar un lavado', description: 'Agenda tu lavado a domicilio' },\n  { id: 'menu:servicios', title: 'Servicios y precios', description: 'Que incluye cada lavado' },\n  { id: 'menu:reservas', title: 'Mis reservas', description: 'Ver, reprogramar o cancelar' },\n  { id: 'menu:zonas', title: 'Zonas de cobertura', description: 'Hasta donde llegamos' },\n  { id: 'menu:humano', title: 'Hablar con alguien', description: 'Te responde una persona' }\n];\nfunction menuMsg(prefix, header) {\n  const body = (prefix || '') + 'Lavado de autos a domicilio en Zona Norte \\ud83d\\ude97\\ud83d\\udca6\\n\\n\\u00bfQue queres hacer?';\n  return msgList(body, 'Ver opciones', MENU_ROWS, header || 'Washero', 'Menu principal');\n}\n\n// ---------------------------------------------------------------------------\n// 1. Decide which step to render from the current state + what the client sent.\n// ---------------------------------------------------------------------------\nconst STEP_OF_STATE = {\n  menu: 'MENU', svc: 'SVC', veh: 'VEH', addrtype: 'ADDRTYPE', addr: 'ADDR',\n  date: 'DATE', time: 'TIME', pay: 'PAY', confirm: 'CONFIRM',\n  mybk: 'MYBK', bkact: 'BKACT', rdate: 'RDATE', rtime: 'RTIME', cxlconf: 'CXLCONF'\n};\nconst isMenuCmd = rid === 'nav:menu' || /^(menu|men\\u00fa|hola|buenas|inicio|volver|empezar|start)$/i.test(low);\nconst isHumanCmd = rid === 'nav:humano';\n\nlet step = 'MENU';\nlet prefix = '';\nlet data = JSON.parse(JSON.stringify(data0));\n\nif (results.length >= MAX_TOOL_CALLS) {\n  step = 'HANDOFF';\n  data.handoff_reason = 'flujo n8n: demasiados pasos internos en un turno';\n} else if (state0 === 'handoff' && !isMenuCmd) {\n  return reply('handoff', data0, null);\n} else if (isHumanCmd) {\n  step = 'HANDOFF';\n  data.handoff_reason = 'el cliente pidio hablar con una persona';\n} else if (isMenuCmd) {\n  step = 'MENU';\n  data = { misses: 0 };\n} else if (mtype === 'image' || mtype === 'document') {\n  step = 'HANDOFF';\n" +
  "  data.handoff_reason = 'el cliente envio una imagen/documento (posible comprobante) - revisar a mano';\n} else if (mtype !== 'text' && mtype !== 'interactive') {\n  step = 'MISS';\n  prefix = 'Por ahora no puedo procesar ese tipo de mensaje \\ud83d\\ude45\\u200d\\u2642\\ufe0f\\n\\n';\n} else {\n  switch (state0) {\n    case 'menu': {\n      const v = ridVal('menu');\n      if (v === 'reservar') { step = 'SVC'; data = { misses: 0 }; }\n      else if (v === 'servicios') { step = 'PRICES'; data.misses = 0; }\n      else if (v === 'zonas') { step = 'ZONES'; data.misses = 0; }\n      else if (v === 'reservas') { step = 'MYBK'; data.misses = 0; }\n      else if (v === 'humano') { step = 'HANDOFF'; data.handoff_reason = 'el cliente pidio hablar con una persona'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'svc': {\n      const v = ridVal('svc');\n      if (v) { data.service_id = v; data.service_name = rtitle || data.service_name || ''; data.misses = 0; step = 'VEH'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'veh': {\n      const v = ridVal('veh');\n      if (v && VEHICLES.indexOf(v) >= 0) { data.vehicle_type = v; data.misses = 0; step = 'ADDRTYPE'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'addrtype': {\n      const v = ridVal('at');\n      if (v === 'street' || v === 'priv') { data.address_type = v === 'priv' ? 'private_neighborhood' : 'street'; data.misses = 0; step = 'ADDR'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'addr': {\n      if (text.length >= 6) { data.address_raw = text; data.misses = 0; step = 'VALIDATE'; }\n      else { step = 'MISS'; prefix = 'Necesito la direccion un poco mas completa \\ud83d\\ude4f\\n\\n'; }\n      break;\n    }\n    case 'date': {\n";
const part1_1 =
  "      const v = ridVal('date');\n      if (v) { data.scheduled_date = v; data.misses = 0; step = 'TIME'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'time': {\n      const v = ridVal('time');\n      if (v === 'back') { data.misses = 0; step = 'DATE'; }\n      else if (v) { data.scheduled_time = v; data.misses = 0; step = 'PAY'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'pay': {\n      const v = ridVal('pay');\n      if (v === 'mp') { data.payment_method = 'MercadoPago'; data.misses = 0; step = 'CONFIRM'; }\n      else if (v === 'tr') { data.payment_method = 'Transferencia'; data.misses = 0; step = 'CONFIRM'; }\n      else if (v === 'later') { data.payment_method = 'Pagar despues'; data.misses = 0; step = 'CONFIRM'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'confirm': {\n      const v = ridVal('cf');\n      if (v === 'yes') { data.misses = 0; step = 'CREATE'; }\n      else if (v === 'no') { step = 'MENU'; data = { misses: 0 }; prefix = 'Listo, descarte esa reserva \\u2705\\n\\n'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'mybk': {\n      const v = ridVal('bk');\n      if (v) { data.sel_booking_id = v; data.misses = 0; step = 'BKACT'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'bkact': {\n      const v = ridVal('act');\n      if (v === 'resched') { data.misses = 0; step = 'RDATE'; }\n      else if (v === 'cancel') { data.misses = 0; step = 'CXLCONF'; }\n      else if (v === 'back') { data.misses = 0; step = 'MYBK'; }\n      else step = 'MISS';\n      break;\n" +
  "    }\n    case 'rdate': {\n      const v = ridVal('date');\n      if (v) { data.new_date = v; data.misses = 0; step = 'RTIME'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'rtime': {\n      const v = ridVal('time');\n      if (v) { data.new_time = v; data.misses = 0; step = 'RESCHED'; }\n      else step = 'MISS';\n      break;\n    }\n    case 'cxlconf': {\n      const v = ridVal('cf');\n      if (v === 'yes') { data.misses = 0; step = 'DOCANCEL'; }\n      else if (v === 'no') { data.misses = 0; step = 'BKACT'; }\n      else step = 'MISS';\n      break;\n    }\n    default: { step = 'MENU'; data = { misses: 0 }; }\n  }\n}\n\n// Unrecognized input: re-send the current step, and after 3 in a row hand off to a human.\nif (step === 'MISS') {\n  const m = (Number(data.misses) || 0) + 1;\n  data.misses = m;\n  if (m >= 3) {\n    step = 'HANDOFF';\n    data.handoff_reason = 'el cliente escribio 3 veces algo que el flujo por botones no reconoce';\n  } else {\n    step = STEP_OF_STATE[state0] || 'MENU';\n    prefix = prefix || 'Perdon, no te entendi \\ud83e\\udd14 Toca una de las opciones:\\n\\n';\n  }\n}\n\n// ---------------------------------------------------------------------------\n// 2. Render the step. A step may need tool results first; it asks for one call\n//    at a time and is re-entered with the answer appended to `results`.\n" +
  "// ---------------------------------------------------------------------------\nfunction fail(msg) {\n  return reply('menu', { misses: 0 }, msgList(msg + '\\n\\n\\u00bfQue queres hacer?', 'Ver opciones', MENU_ROWS, 'Washero', 'Menu principal'));\n}\n\nfunction render(st) {\n  switch (st) {\n    case 'MENU':\n      // Carries `misses` through: resetting it here would make the 3-strikes\n      // handoff unreachable, since an unrecognized reply at the menu re-renders MENU.\n      return reply('menu', { misses: Number(data.misses) || 0 }, menuMsg(prefix));\n\n    case 'PRICES': {\n      const r = byTool('get_services');\n      if (!r) return callTool('get_services', {});\n      if (!r.ok) return fail('No pude traer los precios ahora \\ud83d\\ude13');\n      let body = 'Nuestros servicios \\ud83e\\uddfc\\n\\n';\n      (r.services || []).forEach(function (s) { body += '\\u2022 ' + s.name + ' - desde ' + money(s.base_price) + '\\n'; });\n      body += '\\nEl precio final depende del tipo de vehiculo.\\n\\n\\u00bfQue queres hacer?';\n      return reply('menu', { misses: 0 }, msgList(body, 'Ver opciones', MENU_ROWS, 'Servicios y precios', 'Menu principal'));\n    }\n\n    case 'ZONES': {\n      const r = byTool('list_coverage_zones');\n      if (!r) return callTool('list_coverage_zones', {});\n      if (!r.ok) return fail('No pude traer las zonas ahora \\ud83d\\ude13');\n      let body = 'Zonas donde llegamos \\ud83d\\udccd\\n\\n' + (r.zones || []).join(', ');\n      if ((r.private_neighborhoods || []).length) body += '\\n\\nBarrios privados: ' + r.private_neighborhoods.join(', ');\n      body += '\\n\\n\\u00bfQue queres hacer?';\n      return reply('menu', { misses: 0 }, msgList(body, 'Ver opciones', MENU_ROWS, 'Cobertura', 'Menu principal'));\n    }\n\n    case 'SVC': {\n      const r = byTool('get_services');\n      if (!r) return callTool('get_services', {});\n      const svc = (r && r.services) || [];\n      if (!svc.length) return fail('No pude traer los servicios ahora \\ud83d\\ude13');\n      const rows = svc.map(function (s) { return { id: 'svc:' + s.id, title: s.name, description: 'desde ' + money(s.base_price) }; });\n      return reply('svc', data, msgList(prefix + 'Elegi el servicio que queres \\ud83d\\udc47', 'Ver servicios', rows, 'Paso 1 de 6', 'Servicios'));\n    }\n" +
  "\n    case 'VEH': {\n      const rows = VEHICLES.map(function (v) { return { id: 'veh:' + v, title: v }; });\n      const body = prefix + 'Anotado: *' + (data.service_name || 'tu servicio') + '*.\\n\\n\\u00bfQue tipo de vehiculo es?';\n      return reply('veh', data, msgList(body, 'Ver opciones', rows, 'Paso 2 de 6', 'Vehiculo'));\n    }\n\n    case 'ADDRTYPE': {\n      const btns = [{ id: 'at:street', title: 'Calle / avenida' }, { id: 'at:priv', title: 'Barrio privado' }];\n      return reply('addrtype', data, msgButtons(prefix + '\\u00bfDonde lavamos? Deci si es una direccion de calle o un barrio privado/country.', btns, 'Paso 3 de 6'));\n    }\n\n    case 'ADDR': {\n      const priv = data.address_type === 'private_neighborhood';\n      const body = prefix + (priv\n        ? 'Escribime el nombre del barrio privado y el lote. Ej: _Nordelta, Barrio Los Alisos, lote 42_'\n        : 'Escribime tu direccion completa (calle, altura y localidad). Ej: _Av. del Libertador 1234, Martinez_');\n      return reply('addr', data, msgText(body));\n    }\n\n    case 'VALIDATE': {\n      const v = byTool('validate_service_area');\n      if (!v) return callTool('validate_service_area', {\n        address: data.address_type === 'private_neighborhood' ? '' : data.address_raw,\n        neighborhood: data.address_raw,\n        address_type: data.address_type || 'street',\n        private_neighborhood_name: data.address_type === 'private_neighborhood' ? data.address_raw : ''\n      });\n      if (!v.inside_coverage) {\n        data.handoff_reason = 'direccion fuera de cobertura o no reconocida: ' + (data.address_raw || '');\n        return render('HANDOFF');\n      }\n      data.address = data.address_raw;\n      data.neighborhood = v.coverage_zone_name || v.private_neighborhood_name || data.address_raw;\n      if (v.private_neighborhood_id) data.private_neighborhood_id = v.private_neighborhood_id;\n      prefix = 'Direccion confirmada, estamos en zona \\u2705\\n\\n';\n      return render('DATE');\n    }\n\n    case 'DATE': {\n";
const part1_2 =
  "      const r = byTool('get_available_dates');\n      if (!r) return callTool('get_available_dates', { service_id: data.service_id, vehicle_type: data.vehicle_type || 'Auto' });\n      const dates = (r.dates || []).filter(function (d) { return (Number(d.slots_available) || 0) > 0; });\n      if (!dates.length) {\n        data.handoff_reason = 'no hay turnos disponibles en los proximos 14 dias';\n        return render('HANDOFF');\n      }\n      const rows = dates.slice(0, 9).map(function (d) {\n        return { id: 'date:' + d.date, title: fmtDate(d.date), description: d.slots_available + ' horarios libres' };\n      });\n      rows.push({ id: 'nav:humano', title: 'Otra fecha', description: 'Coordinar con una persona' });\n      return reply('date', data, msgList(prefix + 'Elegi el dia \\ud83d\\udcc5', 'Ver fechas', rows, 'Paso 4 de 6', 'Dias disponibles'));\n    }\n\n    case 'TIME': {\n      const r = byTool('get_available_slots');\n      if (!r) return callTool('get_available_slots', { date: data.scheduled_date, service_id: data.service_id, vehicle_type: data.vehicle_type || 'Auto' });\n      const slots = r.slots || [];\n      if (!slots.length) { prefix = 'Ese dia se quedo sin lugar \\ud83d\\ude15 Elegi otro:\\n\\n'; return render('DATE'); }\n      const rows = slots.slice(0, 9).map(function (s) {\n        return { id: 'time:' + s.start_time, title: fmtTime(s.start_time) + ' hs', description: 'termina ~' + fmtTime(s.end_time) + ' hs' };\n      });\n      rows.push({ id: 'time:back', title: 'Cambiar de dia' });\n      return reply('time', data, msgList(prefix + 'Turnos del ' + fmtDate(data.scheduled_date) + ' \\u23f0', 'Ver horarios', rows, 'Paso 5 de 6', 'Horarios'));\n    }\n\n    case 'PAY': {\n      const q = byTool('calculate_booking_price');\n      if (!q) return callTool('calculate_booking_price', { service_id: data.service_id, vehicle_type: data.vehicle_type || 'Auto', vehicle_count: 1 });\n      if (!q.ok) return fail('No pude calcular el precio \\ud83d\\ude13');\n      data.price = q.total_amount;\n      const btns = [{ id: 'pay:mp', title: 'Mercado Pago' }, { id: 'pay:tr', title: 'Transferencia' }, { id: 'pay:later', title: 'Pagar despues' }];\n      const body = prefix + 'Total: *' + money(q.total_amount) + '*\\n(' + (data.service_name || 'servicio') + ' - ' + (data.vehicle_type || '') + ')\\n\\n\\u00bfComo preferis pagar?';\n      return reply('pay', data, msgButtons(body, btns, 'Paso 6 de 6'));\n    }\n\n    case 'CONFIRM': {\n      if (data.price == null) {\n        const q = byTool('calculate_booking_price');\n        if (!q) return callTool('calculate_booking_price', { service_id: data.service_id, vehicle_type: data.vehicle_type || 'Auto', vehicle_count: 1 });\n" +
  "        data.price = q.total_amount;\n      }\n      const body = prefix + 'Repasemos \\ud83d\\udccb\\n\\n' +\n        '\\u2022 Servicio: ' + (data.service_name || '-') + '\\n' +\n        '\\u2022 Vehiculo: ' + (data.vehicle_type || '-') + '\\n' +\n        '\\u2022 Cuando: ' + fmtDate(data.scheduled_date) + ' a las ' + fmtTime(data.scheduled_time) + ' hs\\n' +\n        '\\u2022 Donde: ' + (data.address || '-') + '\\n' +\n        '\\u2022 Pago: ' + (data.payment_method || '-') + '\\n' +\n        '\\u2022 Total: ' + money(data.price) + '\\n\\n\\u00bfConfirmamos?';\n      return reply('confirm', data, msgButtons(body, [{ id: 'cf:yes', title: 'Confirmar' }, { id: 'cf:no', title: 'Cancelar' }], 'Confirmacion'));\n    }\n\n    case 'CREATE': {\n      const cb = byTool('create_booking');\n      if (!cb) return callTool('create_booking', {\n        customer_name: norm.name || '',\n        address: data.address,\n        neighborhood: data.neighborhood,\n        address_type: data.address_type || 'street',\n        private_neighborhood_id: data.private_neighborhood_id || '',\n        service_id: data.service_id,\n        vehicle_type: data.vehicle_type || 'Auto',\n        scheduled_date: data.scheduled_date,\n        scheduled_time: data.scheduled_time,\n        payment_method: data.payment_method,\n        confirmation_message_id: norm.external_message_id || ''\n      });\n      if (!cb.ok) {\n        if (cb.reason === 'slot_unavailable' || cb.reason === 'no_capacity') {\n          prefix = 'Uy, justo se ocupo ese turno \\ud83d\\ude13 Elegi otro dia:\\n\\n';\n          return render('DATE');\n        }\n        data.handoff_reason = 'create_booking fallo: ' + (cb.reason || cb.message || 'desconocido');\n        return render('HANDOFF');\n      }\n      const bk = cb.booking || {};\n      let body = '\\u00a1Listo! Tu reserva quedo confirmada \\u2705\\n\\n' +\n        '\\u2022 ' + (bk.service_name || data.service_name || '-') + ' - ' + (bk.vehicle_type || data.vehicle_type || '') + '\\n' +\n        '\\u2022 ' + fmtDate(bk.scheduled_date || data.scheduled_date) + ' a las ' + fmtTime(bk.scheduled_time || data.scheduled_time) + ' hs\\n' +\n        '\\u2022 ' + (bk.address || data.address || '') + '\\n' +\n" +
  "        '\\u2022 Total: ' + money(bk.price != null ? bk.price : data.price) + '\\n';\n      if (data.payment_method === 'MercadoPago') {\n        const pl = byTool('get_payment_link');\n        if (!pl) return callTool('get_payment_link', { booking_id: bk.id });\n        if (pl.ok && pl.checkout_url) body += '\\nPaga aca \\ud83d\\udc47\\n' + pl.checkout_url;\n        else body += '\\nEn un rato te mandamos el link de pago.';\n      } else if (data.payment_method === 'Transferencia') {\n        body += '\\nTe pasamos los datos para transferir antes del lavado.';\n      } else {\n        body += '\\nPodes pagar el dia del lavado.';\n      }\n      body += '\\n\\nEscribi *menu* cuando quieras volver al inicio.';\n      return reply('none', { misses: 0 }, msgText(body));\n    }\n\n    case 'MYBK': {\n      const r = byTool('list_customer_bookings');\n      if (!r) return callTool('list_customer_bookings', { limit: 20 });\n      const all = (r.bookings || []).filter(function (b) {\n        return b.booking_status !== 'cancelled' && b.booking_status !== 'completed';\n      });\n      if (!all.length) return fail('No encontre reservas activas a tu nombre \\ud83d\\udd0d');\n      const rows = all.slice(0, 10).map(function (b) {\n        return {\n          id: 'bk:' + b.id,\n          title: fmtDate(b.scheduled_date) + ' ' + fmtTime(b.scheduled_time),\n          description: (b.service_name || '') + ' - ' + money(b.price)\n        };\n      });\n      return reply('mybk', data, msgList(prefix + 'Tus reservas activas \\ud83d\\udccb\\nElegi una para ver que hacer:', 'Ver reservas', rows, 'Mis reservas', 'Reservas'));\n    }\n\n    case 'BKACT': {\n      const r = byTool('get_booking');\n      if (!r) return callTool('get_booking', { booking_id: data.sel_booking_id });\n      const b = r.booking || {};\n      if (!r.ok || !b.id) return fail('No pude encontrar esa reserva \\ud83d\\ude13');\n      const body = prefix + 'Reserva del ' + fmtDate(b.scheduled_date) + ' a las ' + fmtTime(b.scheduled_time) + ' hs\\n\\n' +\n        '\\u2022 ' + (b.service_name || '-') + ' - ' + (b.vehicle_type || '') + '\\n' +\n        '\\u2022 ' + (b.address || '') + '\\n' +\n" +
  "        '\\u2022 ' + money(b.price) + ' - ' + (b.payment_method || '') + '\\n\\n\\u00bfQue queres hacer?';\n      const btns = [{ id: 'act:resched', title: 'Reprogramar' }, { id: 'act:cancel', title: 'Cancelar' }, { id: 'act:back', title: 'Volver' }];\n      return reply('bkact', data, msgButtons(body, btns, 'Tu reserva'));\n    }\n\n    case 'RDATE': {\n      const g = byTool('get_booking');\n      if (!g) return callTool('get_booking', { booking_id: data.sel_booking_id });\n      const b = g.booking || {};\n      const sd = byTool('get_service_details');\n      if (!sd) return callTool('get_service_details', { service_name: b.service_name });\n      if (!sd.ok || !sd.service) return fail('No pude reprogramar esa reserva \\ud83d\\ude13');\n      data.r_service_id = sd.service.id;\n      data.r_vehicle_type = b.vehicle_type || 'Auto';\n      const av = byTool('get_available_dates');\n      if (!av) return callTool('get_available_dates', { service_id: sd.service.id, vehicle_type: data.r_vehicle_type });\n      const dates = (av.dates || []).filter(function (d) { return (Number(d.slots_available) || 0) > 0; });\n      if (!dates.length) {\n        data.handoff_reason = 'no hay fechas libres para reprogramar la reserva ' + data.sel_booking_id;\n        return render('HANDOFF');\n      }\n      const rows = dates.slice(0, 9).map(function (d) { return { id: 'date:' + d.date, title: fmtDate(d.date), description: d.slots_available + ' horarios libres' }; });\n      rows.push({ id: 'nav:humano', title: 'Otra fecha', description: 'Coordinar con una persona' });\n      return reply('rdate', data, msgList(prefix + 'Elegi el nuevo dia \\ud83d\\udcc5', 'Ver fechas', rows, 'Reprogramar', 'Dias disponibles'));\n    }\n\n    case 'RTIME': {\n      const av = byTool('get_available_slots');\n      if (!av) return callTool('get_available_slots', { date: data.new_date, service_id: data.r_service_id, vehicle_type: data.r_vehicle_type || 'Auto' });\n      const slots = av.slots || [];\n      if (!slots.length) { prefix = 'Ese dia se quedo sin lugar \\ud83d\\ude15 Elegi otro:\\n\\n'; return render('RDATE'); }\n      const rows = slots.slice(0, 10).map(function (s) { return { id: 'time:' + s.start_time, title: fmtTime(s.start_time) + ' hs' }; });\n      return reply('rtime', data, msgList(prefix + 'Turnos del ' + fmtDate(data.new_date) + ' \\u23f0', 'Ver horarios', rows, 'Reprogramar', 'Horarios'));\n    }\n\n    case 'RESCHED': {\n      const r = byTool('reschedule_booking');\n      if (!r) return callTool('reschedule_booking', { booking_id: data.sel_booking_id, new_date: data.new_date, new_time: data.new_time });\n      if (!r.ok) {\n        prefix = 'No pude mover la reserva a ese horario \\ud83d\\ude15 Probemos otro dia:\\n\\n';\n";
const part1_3 =
  "        return render('RDATE');\n      }\n      return reply('none', { misses: 0 }, msgText('Listo, tu reserva quedo para el ' + fmtDate(data.new_date) + ' a las ' + fmtTime(data.new_time) + ' hs \\u2705\\n\\nEscribi *menu* para volver al inicio.'));\n    }\n\n    case 'CXLCONF': {\n      const btns = [{ id: 'cf:yes', title: 'Si, cancelar' }, { id: 'cf:no', title: 'No, volver' }];\n      return reply('cxlconf', data, msgButtons(prefix + '\\u00bfSeguro que queres cancelar esta reserva? No se puede deshacer.', btns, 'Cancelar reserva'));\n    }\n\n    case 'DOCANCEL': {\n      const r = byTool('cancel_booking');\n      if (!r) return callTool('cancel_booking', { booking_id: data.sel_booking_id });\n      if (!r.ok) {\n        data.handoff_reason = 'cancel_booking fallo para ' + data.sel_booking_id;\n        return render('HANDOFF');\n      }\n      return reply('none', { misses: 0 }, msgText('Tu reserva quedo cancelada \\u2705\\n\\nCuando quieras volves a reservar escribiendo *menu*.'));\n    }\n\n    case 'HANDOFF': {\n      const r = byTool('request_human_handoff');\n      if (!r) return callTool('request_human_handoff', { reason: data.handoff_reason || 'derivacion desde el flujo de WhatsApp' });\n      return reply('handoff', { misses: 0 }, msgText('Ya avise a alguien del equipo \\ud83d\\ude4c Te escriben por aca en breve.'));\n    }\n\n    default:\n      return reply('menu', { misses: 0 }, menuMsg(''));\n  }\n}\n\nreturn render(step);";
const flowRouterCode = part1_0 + part1_1 + part1_2 + part1_3;

const flowRouter = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Flow Router',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: flowRouterCode },
    position: [840, -100],
  },
  output: [{ action: 'reply', next_state: 'menu', next_data: { misses: 0 }, payload: { messaging_product: 'whatsapp', to: '541122334455', type: 'interactive' }, log_text: 'Menu principal', has_message: true }],
});

const needsTool = ifElse({
  version: 2.3,
  config: {
    name: 'Needs Tool?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.action }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'call' }],
        combinator: 'and',
      },
      options: {},
    },
    position: [1060, -100],
  },
});

const callTool = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Call Tool',
    parameters: {
      method: 'POST',
      url: 'https://apiwashero.flynnpedroa.engineer/functions/v1/whatsapp-tools',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { tool: $json.tool, customer_phone: $("Normalize Inbound").first().json.phone, conversation_id: $("Normalize Inbound").first().json.conversation_id, customer_name: $("Normalize Inbound").first().json.name, is_test: false, args: $json.args } }}'),
      options: { response: { response: { neverError: true } } },
    },
    credentials: { httpHeaderAuth: { id: 'DHxWaDoMvPTw5sjQ', name: 'Inbound Auth' } },
    position: [1280, -260],
  },
  output: [{ ok: true, services: [{ id: 'uuid-1', name: 'Lavado Completo', base_price: 25000 }] }],
});

const collectToolResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Collect Tool Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "// Closes the interpreter loop: re-attach the router context this call belongs to,\n// append the tool's answer, and hand it back to Flow Router. The router re-derives\n// everything from (state, data, results), so state/data are passed through untouched.\n// Flow Router run N produced the call that Call Tool run N answered, and this node's\n// $runIndex is also N -- addressing the run directly avoids relying on item pairing.\nlet ctx = null;\ntry {\n  const a = $('Flow Router').all(0, $runIndex);\n  if (a && a.length) ctx = a[0].json;\n} catch (e) { ctx = null; }\nif (!ctx) { try { ctx = $('Flow Router').item.json; } catch (e) { ctx = null; } }\nif (!ctx) throw new Error('No pude recuperar el contexto de Flow Router');\n\nconst prev = Array.isArray(ctx.results) ? ctx.results : [];\nconst answer = $input.first().json;\nreturn [{ json: {\n  ok: true,\n  state: ctx.state,\n  data: ctx.data,\n  results: prev.concat([{ tool: ctx.tool, result: answer }])\n} }];",
    },
    position: [1500, -260],
  },
  output: [{ ok: true, state: 'menu', data: {}, results: [{ tool: 'get_services', result: { ok: true, services: [] } }] }],
});

const saveState = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Save Conversation State',
    parameters: {
      method: 'POST',
      url: 'https://apiwashero.flynnpedroa.engineer/functions/v1/whatsapp-tools',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { tool: "set_conversation_state", customer_phone: $("Normalize Inbound").first().json.phone, conversation_id: $("Normalize Inbound").first().json.conversation_id, customer_name: $("Normalize Inbound").first().json.name, is_test: false, args: { state: $json.next_state, data: $json.next_data } } }}'),
      options: {},
    },
    credentials: { httpHeaderAuth: { id: 'DHxWaDoMvPTw5sjQ', name: 'Inbound Auth' } },
    position: [1280, 60],
  },
  output: [{ ok: true, state: 'menu', data: { misses: 0 } }],
});

const prepareSend = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Send',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "// Save Conversation State replaced $json with the tool's answer, so pull the outgoing\n// message back from the router. Scanning run indexes newest-first finds the run that\n// actually produced the reply, whatever number of tool calls the turn needed.\nlet r = null;\nfor (let i = 12; i >= 0 && !r; i--) {\n  try {\n    const a = $('Flow Router').all(0, i);\n    if (a && a.length && a[0].json && a[0].json.action === 'reply') r = a[0].json;\n  } catch (e) { /* that run index does not exist */ }\n}\nif (!r || !r.has_message || !r.payload) return [];\nreturn [{ json: { payload: r.payload, log_text: r.log_text || '' } }];",
    },
    position: [1500, 60],
  },
  output: [{ payload: { messaging_product: 'whatsapp', to: '541122334455', type: 'interactive' }, log_text: 'Menu principal' }],
});

const sendMessage = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Send WhatsApp Message',
    parameters: {
      method: 'POST',
      url: 'https://graph.facebook.com/v20.0/1327924187062435/messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'whatsAppApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.payload }}'),
      options: {},
    },
    credentials: { whatsAppApi: { id: 'UNzeTsqpUlTvZdUq', name: 'WhatsApp account' } },
    position: [1720, 60],
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.OUT' }] }],
});

const logOutbound = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Log Outbound Message',
    parameters: {
      method: 'POST',
      url: 'https://apiwashero.flynnpedroa.engineer/functions/v1/whatsapp-tools',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { tool: "ingest_message", customer_phone: $("Normalize Inbound").first().json.phone, conversation_id: $("Normalize Inbound").first().json.conversation_id, customer_name: $("Normalize Inbound").first().json.name, is_test: false, args: { direction: "outbound", sender_type: "bot", message_type: "text", message_text: $("Prepare Send").first().json.log_text, external_message_id: $json.messages ? $json.messages[0].id : "" } } }}'),
      options: {},
    },
    credentials: { httpHeaderAuth: { id: 'DHxWaDoMvPTw5sjQ', name: 'Inbound Auth' } },
    position: [1940, 60],
  },
  output: [{ ok: true }],
});

const noteIngest = sticky(
  '## 1. Transporte e ingesta\n\nNormaliza el webhook de Meta (incluye el **id** del boton/lista tocado, no solo el titulo) y persiste el mensaje. `should_bot_reply` es false cuando un operador tomo la conversacion: ahi el bot se calla.',
  [normalizeInbound, ingestInbound, shouldBotReply],
  { color: 4 },
);

const noteRouter = sticky(
  '## 2. Maquina de estados (sin AI)\n\n`Flow Router` es una funcion pura de (estado, datos, boton tocado, resultados de tools). Devuelve **o** un tool a llamar **o** el mensaje final + el proximo estado.\n\nEl ciclo `Call Tool -> Collect Tool Result -> Flow Router` resuelve las cadenas que dependen del resultado anterior (ej: create_booking -> get_payment_link). Corta solo a los 8 pasos.',
  [flowRouter, needsTool, callTool, collectToolResult],
  { color: 3 },
);

const noteOut = sticky(
  '## 3. Persistir estado y responder\n\nPrimero se guarda el estado, despues sale el mensaje: un solo mensaje por turno, siempre interactivo (lista o botones) salvo los avisos finales.',
  [saveState, prepareSend, sendMessage, logOutbound],
  { color: 5 },
);

export default workflow('washero-whatsapp-deterministic', 'Washero WhatsApp Inbound (deterministic)')
  .add(inboundWebhook)
  .to(normalizeInbound)
  .to(ingestInbound)
  .to(shouldBotReply.onTrue(getState.to(flowRouter)))
  .add(flowRouter)
  .to(needsTool
    .onTrue(callTool.to(collectToolResult.to(flowRouter)))
    .onFalse(saveState.to(prepareSend.to(sendMessage.to(logOutbound)))))
  .add(noteIngest)
  .add(noteRouter)
  .add(noteOut);
