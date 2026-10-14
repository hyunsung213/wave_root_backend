process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCameraWatchdog } = require('../src/services/cameraWatchdog');
const AlertSettings = require('../src/models/AlertSettings');
const { getAlertSettings, sendDiscordMessage } = require('../src/services/discordAlerts');

test('camera watchdog ignores idle cameras, alerts on repeated live-feed failure, and reports recovery', async () => {
  let camera = { reader_active: false, stream_connected: false };
  const messages = [];
  const watchdog = createCameraWatchdog({
    fetchStatus: async () => [{ cameraId: 'c110-1', status: camera }],
    alert: async (...args) => { messages.push(args); return true; },
    logger: { warn() {} }
  });

  await watchdog.poll();
  assert.equal(messages.length, 0);
  camera = { reader_active: true, stream_connected: false };
  await watchdog.poll();
  assert.equal(messages.length, 0);
  await watchdog.poll();
  assert.deepEqual(messages, [['c110-1', false]]);
  await watchdog.poll();
  assert.equal(messages.length, 1);
  camera = { reader_active: false, stream_connected: true };
  await watchdog.poll();
  assert.deepEqual(messages, [['c110-1', false], ['c110-1', true]]);
});

test('camera watchdog retries an alert that failed to deliver', async () => {
  let attempts = 0;
  const watchdog = createCameraWatchdog({
    fetchStatus: async () => [{ cameraId: 'c110-2', status: { reader_active: true, stream_connected: false } }],
    alert: async () => ++attempts > 1,
    logger: { warn() {} }
  });
  await watchdog.poll();
  await watchdog.poll();
  assert.equal(attempts, 1);
  await watchdog.poll();
  assert.equal(attempts, 2);
});

test('test settings default enabled without requiring MongoDB in test mode', async () => {
  const originalFindOne = AlertSettings.findOne;
  AlertSettings.findOne = () => ({ lean: async () => null });
  try {
    assert.deepEqual(await getAlertSettings(), { signupAlerts: true, orderAlerts: true, cameraAlerts: true });
  } finally { AlertSettings.findOne = originalFindOne; }
});

test('Discord sender only accepts HTTPS Discord webhook URLs and suppresses mentions', async () => {
  const originalUrl = process.env.DISCORD_WEBHOOK_URL;
  const originalFetch = global.fetch;
  let posted;
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret';
  global.fetch = async (_url, options) => {
    posted = JSON.parse(options.body);
    return { ok: true, status: 204 };
  };
  try {
    await sendDiscordMessage({ title: 'test', description: '@everyone', fields: [] });
    assert.deepEqual(posted.allowed_mentions, { parse: [] });
    assert.equal(posted.embeds[0].title, 'test');
    process.env.DISCORD_WEBHOOK_URL = 'https://example.test/webhook';
    await assert.rejects(() => sendDiscordMessage({ title: 'test', description: 'nope' }), /Discord HTTPS webhook URL/);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = originalUrl;
  }
});