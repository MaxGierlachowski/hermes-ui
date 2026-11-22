// Per-chat model choice for new chats. The list comes from Hermes' own `model.options` (the inventory the
// Hermes desktop picker uses); the pick rides on `session.create` as `model` + `provider`, which the
// gateway validates as a pair. No pick = neither field is sent, so the gateway's default applies.

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** `model.options` result -> what the "new chat" picker shows: usable providers with their models. */
export function pickerOptions(result) {
  const providers = (Array.isArray(result?.providers) ? result.providers : [])
    .filter((provider) => text(provider?.slug) && provider.authenticated !== false)
    .map((provider) => {
      const unavailable = new Set(provider.unavailable_models || []);
      const models = [...new Set((provider.models || []).map(text).filter((model) => model && !unavailable.has(model)))];
      return { slug: text(provider.slug), name: text(provider.name) || text(provider.slug), models };
    })
    .filter((provider) => provider.models.length);
  const model = text(result?.model);
  const provider = text(result?.provider);
  return { current: model ? { model, provider: provider || null } : null, providers };
}

/** The `model` + `provider` pair of a create request, or nothing when the request does not carry both. */
export function modelChoice(body) {
  const model = text(body?.model);
  const provider = text(body?.provider);
  return model && provider ? { model, provider } : {};
}
