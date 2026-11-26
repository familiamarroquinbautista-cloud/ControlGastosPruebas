# Configurar el agente en ElevenLabs (mínimo costo)

> 🎙️ (botón grande) = dictado local: registra en ~1 s sin usar ElevenLabs. 🤖 (botón pequeño) = agente, para casos que el dictado no entienda.

1. elevenlabs.io → **Agents** → *Create agent* → *Blank*.
2. **Agent**
   - First message: *(vacío)* · Language: Spanish
   - LLM: el más barato disponible (familia flash-lite / mini) · Temperature 0 · Max tokens 60
   - System prompt:
     ```
     Asistente de gastos del hogar. Usuario {{usuario}}. Hoy {{hoy}}. Moneda COP.
     Categorías (categoria:subcategorias): {{categorias}}
     Reglas: máximo 1 frase, sin saludos. Gasto → registrar_gasto. Ingreso → registrar_ingreso.
     Preguntas de cuánto se ha gastado → consultar_gastos y lee el resultado tal cual.
     Si falta el monto pregúntalo una vez. Nunca inventes cifras. Tras registrar no digas nada: la app cuelga sola.
     ```
3. **Voice**: voz estándar (no clonada), modelo Flash/Turbo.
4. **Tools** → *System tools*: activar `end_call`. Luego *Add tool → Client* (marcar "Wait for response"):
   - `registrar_gasto`: monto (number, requerido), categoria (string), subcategoria (string), descripcion (string), metodo (string: debito|credito)
   - `registrar_ingreso`: monto (number, requerido), tipo (string: Nomina|Prima|Prestamo|Subsidio|Otros), descripcion (string)
   - `consultar_gastos`: categoria (string, opcional)
5. **Advanced**: Max conversation duration 60 s · silencio/turn timeout 5–7 s.
   - Velocidad: LLM rápido (Gemini Flash / Flash-Lite) · TTS modelo *Flash v2.5* · *Optimize streaming latency* al máximo · *Turn eagerness*: Eager.
6. **Security**: Authentication desactivado · Allowlist: `familiamarroquinbautista-cloud.github.io`.
7. Copiar el **Agent ID** y pegarlo en `agente.js` (`AGENT_ID`).
8. En la cuenta: poner un límite de uso mensual.
