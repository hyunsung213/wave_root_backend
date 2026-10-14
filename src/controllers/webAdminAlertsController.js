const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const {
  getAlertSettings,
  updateAlertSettings,
  sendDiscordMessage
} = require('../services/discordAlerts');

const getAdminAlertSettings = asyncHandler(async (_req, res) => {
  const [settings, env] = await Promise.all([getAlertSettings(), Promise.resolve(getEnv())]);
  let webhookConfigured = false;
  if (env.discordWebhookUrl) {
    try {
      const url = new URL(env.discordWebhookUrl);
      webhookConfigured = url.protocol === 'https:' &&
        ['discord.com', 'discordapp.com'].includes(url.hostname) &&
        url.pathname.startsWith('/api/webhooks/');
    } catch (_error) { /* a malformed secret is not exposed to the admin page */ }
  }
  res.json({ success: true, settings, webhookConfigured });
});

const updateAdminAlertSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const allowed = ['signupAlerts', 'orderAlerts', 'cameraAlerts'];
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key)) ||
      Object.values(body).some((value) => typeof value !== 'boolean')) {
    throw new AppError('Provide one or more boolean alert settings only.', 400);
  }
  res.json({ success: true, settings: await updateAlertSettings(body) });
});

const sendAdminTestAlert = asyncHandler(async (_req, res) => {
  try {
    await sendDiscordMessage({
      title: 'ROOT 관리자 알림 테스트',
      description: 'Discord 웹훅 연결이 정상적으로 작동합니다.',
      color: 0x1bb0a6
    });
  } catch (error) {
    throw new AppError(error.message.includes('not configured')
      ? 'DISCORD_WEBHOOK_URL이 서버에 설정되지 않았습니다.'
      : 'Discord 웹훅 전송에 실패했습니다. URL과 채널 권한을 확인해주세요.',
    error.message.includes('not configured') ? 503 : 502);
  }
  res.json({ success: true, message: 'Discord 테스트 알림을 보냈습니다.' });
});

module.exports = { getAdminAlertSettings, updateAdminAlertSettings, sendAdminTestAlert };