# Pitch (3 minutos)

**Problema (40 s).** Pregúntale a un agente de IA si te pueden cobrar una deuda un domingo. Te
responde seguro, y a veces cita una ley que no existe o un artículo derogado. La ley es pública,
pero está en páginas y PDF escaneados que ningún agente lee bien. Y una base jurídica
se vende por suscripción a personas: un agente no llena formularios ni firma contratos.

**Usuario (20 s).** Quien construye agentes: de atención al cliente, de cobranza, de arriendos, de
cumplimiento. Necesitan una respuesta con fuente, de vez en cuando, sin suscripción.

**Solución y demo (80 s).** leyes-402 vende ley por consulta.
1. `curl -i .../asesoria?q=...` → **402**: cuánto cuesta y a qué cuenta.
2. El agente compara con su tope, firma, paga 0.02 USDC en Stellar y recibe artículos y argumentos.
3. Abre el hash en stellar.expert: el pago es real y el agente lo verificó en la red.
4. El LLM redacta con esas citas, cada una con enlace a la fuente oficial.
5. Pregunta por una receta de lasaña: 404 y **no cobra**. Reenvía el mismo pago: **no cobra dos veces**.

**Por qué funciona (25 s).** La pregunta de la calle pasa a lenguaje jurídico y se busca por significado;
se entrega el texto de la ley igual a la fuente, con sus notas de vigencia y su procedencia.
Y si una ley cita a otra, esa también se puede consultar.
Con preguntas escritas por otro modelo, 39 de 44 traen el artículo correcto.

**Siguiente paso (15 s).** Más normas hasta cubrir Colombia (códigos, decretos, jurisprudencia),
transcribir más PDF escaneados y anunciarla en Bazaar para que los agentes la descubran solos.
