const AlertSettings = require('../models/AlertSettings');
const { getEnv } = require('../config/env');

const DEFAULT_SETTINGS = Object.freeze({
  signupAlerts: true,
  orderAlerts: true,
  cameraAlerts: true
});

async function getAlertSettings() {
  const settings = await AlertSettings.findOne({ key: 'global' }).lean();
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [
    key, typeof settings?.[key] === 'boolean' ? settings[key] : DEFAULT_SETTINGS[key]
  ]));
}

async function updateAlertSettings(updates) {
  const settings = await AlertSettings.findOneAndUpdate(
    { key: 'global' },
    { $set: updates, $setOnInsert: { key: 'global' } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [
    key, typeof settings?.[key] === 'boolean' ? settings[key] : DEFAULT_SETTINGS[key]
  ]));
}

async function sendDiscordMessage({ title, description, color = 0x1bb0a6, fields = [] }) {
  const webhookUrl = getEnv().discordWebhookUrl;
  if (!webhookUrl) throw new Error('DISCORD_WEBHOOK_URL is not configured.');
  const parsedUrl = new URL(webhookUrl);
  if (parsedUrl.protocol !== 'https:' ||
      !['discord.com', 'discordapp.com'].includes(parsedUrl.hostname) ||
      !parsedUrl.pathname.startsWith('/api/webhooks/')) {
    throw new Error('DISCORD_WEBHOOK_URL must be a Discord HTTPS webhook URL.');
  }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: String(title).slice(0, 256),
        description: String(description).slice(0, 4096),
        color,
        fields: fields.slice(0, 25).map((field) => ({
          name: String(field.name).slice(0, 256),
          value: String(field.value).slice(0, 1024),
          inline: Boolean(field.inline)
        })),
        timestamp: new Date().toISOString()
      }],
      allowed_mentions: { parse: [] }
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}.`);
}

async function sendConfiguredAlert(settingName, message) {
  if (!getEnv().discordWebhookUrl) return false;
  try {
    const settings = await getAlertSettings();
    if (!settings[settingName]) return null;
    await sendDiscordMessage(message);
    return true;
  } catch (error) {
    console.error('Discord alert failed:', error.message);
    return false;
  }
}

function sendSignupAlert(user) {
  return sendConfiguredAlert('signupAlerts', {
    title: '새 회원 가입',
    description: 'ROOT 서비스에 새 회원이 가입했습니다.',
    fields: [
      { name: '이름', value: user.name || '이름 미입력', inline: true },
      { name: '이메일', value: user.email, inline: true }
    ]
  });
}

function sendOrderAlert(order, user) {
  return sendConfiguredAlert('orderAlerts', {
    title: '새 분양 주문',
    description: '입금 확인이 필요한 새 주문이 접수됐습니다.',
    color: 0xf2c14e,
    fields: [
      { name: '주문 번호', value: order.orderNumber, inline: true },
      { name: '회원', value: user.name || user.email || '회원', inline: true },
      { name: '상품 / 식물 이름', value: `${order.productName} · ${order.plantName}` },
      { name: '결제 예정액', value: `${Number(order.amountDue).toLocaleString('ko-KR')}원`, inline: true },
      ...(order.couponCode ? [{ name: '쿠폰', value: order.couponCode, inline: true }] : [])
    ]
  });
}

function sendCameraAlert(cameraId, recovered = false) {
  return sendConfiguredAlert('cameraAlerts', {
    title: recovered ? '카메라 영상 복구' : '카메라 영상 중단',
    description: recovered
      ? `${cameraId} 카메라에서 영상 프레임 수신이 복구됐습니다.`
      : `${cameraId} 카메라가 요청 중인데 새 영상 프레임을 보내지 않고 있습니다.`,
    color: recovered ? 0x2ecc71 : 0xe74c3c
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  getAlertSettings,
  updateAlertSettings,
  sendDiscordMessage,
  sendSignupAlert,
  sendOrderAlert,
  sendCameraAlert
};