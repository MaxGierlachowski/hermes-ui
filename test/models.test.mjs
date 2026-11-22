import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelChoice, pickerOptions } from '../src/models.mjs';
import { HermesGateway } from '../src/hermes-ws.mjs';

test('picker options keep usable providers with their available models', () => {
  const options = pickerOptions({
    model: 'claude-opus-5-5',
    provider: 'anthropic',
    providers: [
      { slug: 'anthropic', name: 'Anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-old', 'claude-opus-5-5'], unavailable_models: ['claude-old'], authenticated: true },
      { slug: 'openrouter', name: '', models: ['google/gemini-2.5-pro'] },
      { slug: 'nous', name: 'Nous Portal', models: ['hermes-4'], authenticated: false },
      { slug: 'empty', name: 'Empty', models: [] },
      { name: 'No slug', models: ['x'] },
    ],
  });
  assert.deepEqual(options, {
    current: { model: 'claude-opus-5-5', provider: 'anthropic' },
    providers: [
      { slug: 'anthropic', name: 'Anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
      { slug: 'openrouter', name: 'openrouter', models: ['google/gemini-2.5-pro'] },
    ],
  });
});

test('picker options tolerate an empty or malformed gateway answer', () => {
  assert.deepEqual(pickerOptions(undefined), { current: null, providers: [] });
  assert.deepEqual(pickerOptions({ providers: 'nope', model: '' }), { current: null, providers: [] });
});

test('a model choice needs both model and provider', () => {
  assert.deepEqual(modelChoice({ model: ' claude-sonnet-5-5 ', provider: 'anthropic' }), { model: 'claude-sonnet-5-5', provider: 'anthropic' });
  assert.deepEqual(modelChoice({ model: 'claude-sonnet-5-5' }), {});
  assert.deepEqual(modelChoice({ provider: 'anthropic' }), {});
  assert.deepEqual(modelChoice({ model: 1, provider: {} }), {});
  assert.deepEqual(modelChoice(undefined), {});
});

const recordingGateway = () => {
  const gateway = new HermesGateway({ hermesHome: '/nonexistent' });
  gateway.calls = [];
  gateway.call = async (method, params, timeoutMs) => { gateway.calls.push({ method, params, timeoutMs }); return { session_id: 'sid' }; };
  return gateway;
};

test('session.create carries model + provider only when both are chosen', async () => {
  const gateway = recordingGateway();
  await gateway.createSession({ title: 'T' });
  await gateway.createSession({ title: 'T', model: 'claude-sonnet-5-5', provider: 'anthropic' });
  await gateway.createSession({ title: 'T', model: 'claude-sonnet-5-5' });
  const [plain, picked, partial] = gateway.calls.map((c) => c.params);
  assert.equal('model' in plain || 'provider' in plain, false, 'default chat sends neither field');
  assert.equal(picked.model, 'claude-sonnet-5-5');
  assert.equal(picked.provider, 'anthropic');
  assert.equal('model' in partial || 'provider' in partial, false);
});

test('model options are read from the gateway with a long timeout', async () => {
  const gateway = recordingGateway();
  await gateway.modelOptions();
  assert.deepEqual(gateway.calls, [{ method: 'model.options', params: {}, timeoutMs: 60000 }]);
});
